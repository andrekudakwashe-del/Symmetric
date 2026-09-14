package com.saimetric.pos.sync;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * SyncEngine.java V2
 * Handles: P2P Epidemic Sync + Tenant Isolation + Conflict Resolution + Cloud Upload Notification
 */
public class SyncEngine implements MeshManager.MeshEventListener {
    private static final String TAG = "SyncEngine";
    public static final int INITIAL_TTL = 5;

    private final Context context;
    private final String deviceId;
    private final String tenantId;
    private final String branchId;
    private final MeshManager meshManager;
    private final DatabaseHelper.AppDatabase database;
    private final ExecutorService engineExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean isRunning = true;

    // Deduplication Set to prevent broadcast storms / loops
    private final Set<String> processedPacketIds = Collections.newSetFromMap(
            new LinkedHashMap<String, Boolean>(2000, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > 2000;
                }
            }
    );

    private SyncListener listener;

    public interface SyncListener {
        void onRecordSynced(String table, String recordUuid, String source);
        void onQueueUpdated(int pendingCount);
        void onSyncedAckReceived(List<String> syncedUuids);
    }

    public SyncEngine(Context context, String tenantId, String branchId, String deviceId, MeshManager meshManager) {
        this.context = context.getApplicationContext();
        this.tenantId = tenantId;
        this.branchId = branchId;
        this.deviceId = deviceId;
        this.meshManager = meshManager;
        this.database = DatabaseHelper.getDatabase(this.context);

        if (this.meshManager != null) {
            this.meshManager.setListener(this);
        }
    }

    public void setListener(SyncListener listener) {
        this.listener = listener;
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getBranchId() {
        return branchId;
    }

    public String getDeviceId() {
        return deviceId;
    }

    // =========================================================================
    // 1. Broadcast New Local Record to Mesh
    // =========================================================================
    public void broadcastRecord(String table, String recordUuid, String hash, JSONObject payload) {
        engineExecutor.execute(() -> {
            try {
                String packetId = UUID.randomUUID().toString();
                processedPacketIds.add(packetId);

                // 1. Enqueue in local Room sync_queue
                DatabaseHelper.SyncQueueEntity queueEntity = new DatabaseHelper.SyncQueueEntity(
                        recordUuid, tenantId, branchId, table, deviceId, System.currentTimeMillis(), hash, payload.toString(), 0
                );
                database.syncQueueDao().enqueue(queueEntity);

                // 2. Wrap in epidemic broadcast packet with tenant_id header
                JSONObject packet = new JSONObject();
                packet.put("packet_id", packetId);
                packet.put("type", "SYNC_RECORD");
                packet.put("tenant_id", tenantId);
                packet.put("branch_id", branchId);
                packet.put("origin_device_id", deviceId);
                packet.put("ttl", INITIAL_TTL);
                packet.put("table", table);
                packet.put("record_uuid", recordUuid);
                packet.put("hash", hash);
                packet.put("timestamp", queueEntity.timestamp);
                packet.put("payload", payload);

                if (meshManager != null) {
                    meshManager.broadcastMessage(packet.toString());
                }

                notifyQueueUpdated();
            } catch (Exception e) {
                Log.e(TAG, "Error broadcasting record: " + e.getMessage(), e);
            }
        });
    }

    // =========================================================================
    // 2. Broadcast Synced Acknowledgment (removes from mesh queues)
    // =========================================================================
    public void broadcastSyncedUuids(List<String> syncedUuids) {
        if (syncedUuids == null || syncedUuids.isEmpty()) return;

        engineExecutor.execute(() -> {
            try {
                String packetId = UUID.randomUUID().toString();
                processedPacketIds.add(packetId);

                JSONObject packet = new JSONObject();
                packet.put("packet_id", packetId);
                packet.put("type", "SYNCED_ACK");
                packet.put("tenant_id", tenantId);
                packet.put("branch_id", branchId);
                packet.put("origin_device_id", deviceId);
                packet.put("ttl", INITIAL_TTL);

                JSONArray arr = new JSONArray();
                for (String u : syncedUuids) {
                    arr.put(u);
                }
                packet.put("synced_uuids", arr);

                if (meshManager != null) {
                    meshManager.broadcastMessage(packet.toString());
                }

                notifyQueueUpdated();
            } catch (Exception e) {
                Log.e(TAG, "Error broadcasting synced ACKs: " + e.getMessage(), e);
            }
        });
    }

    // =========================================================================
    // 3. Handle Inbound Mesh Messages (with Strict Tenant Isolation)
    // =========================================================================
    @Override
    public void onMessageReceived(String peerId, String messageJson) {
        engineExecutor.execute(() -> {
            try {
                JSONObject packet = new JSONObject(messageJson);

                // STRICT TENANT ISOLATION: Drop packets from different tenants
                String packetTenantId = packet.optString("tenant_id", "");
                if (!tenantId.equals(packetTenantId)) {
                    Log.w(TAG, "DROPPED CROSS-TENANT PACKET. Expected: " + tenantId + ", Received: " + packetTenantId + " from peer " + peerId);
                    return;
                }

                String packetId = packet.optString("packet_id", "");
                if (packetId.isEmpty() || processedPacketIds.contains(packetId)) {
                    return; // Already processed, discard
                }
                processedPacketIds.add(packetId);

                String type = packet.optString("type", "");
                int ttl = packet.optInt("ttl", 0);

                if ("SYNC_RECORD".equals(type)) {
                    handleSyncRecordPacket(peerId, packet);
                } else if ("SYNCED_ACK".equals(type)) {
                    handleSyncedAckPacket(peerId, packet);
                } else if ("REQUEST_CATCHUP".equals(type)) {
                    handleCatchupRequest(peerId);
                }

                // Forward packet via Epidemic gossip if TTL > 1
                if (ttl > 1 && meshManager != null) {
                    packet.put("ttl", ttl - 1);
                    meshManager.broadcastMessageExcept(peerId, packet.toString());
                }

            } catch (Exception e) {
                Log.e(TAG, "Error handling mesh packet: " + e.getMessage(), e);
            }
        });
    }

    private void handleSyncRecordPacket(String peerId, JSONObject packet) {
        try {
            String table = packet.getString("table");
            String recordUuid = packet.getString("record_uuid");
            String hash = packet.getString("hash");
            long timestamp = packet.getLong("timestamp");
            String originDeviceId = packet.getString("origin_device_id");
            JSONObject payload = packet.getJSONObject("payload");

            if ("sales".equals(table)) {
                DatabaseHelper.SaleEntity existing = database.saleDao().getByUuid(recordUuid);
                if (existing == null) {
                    // New sale from peer
                    DatabaseHelper.SaleEntity sale = new DatabaseHelper.SaleEntity(
                            recordUuid,
                            tenantId,
                            packet.optString("branch_id", branchId),
                            originDeviceId,
                            timestamp,
                            "pending",
                            hash,
                            payload.optString("invoice_number", ""),
                            payload.optString("customer_name", "Walk-in"),
                            payload.optDouble("total_amount", 0.0),
                            payload.optString("payment_method", "Cash"),
                            payload.optString("staff_id", ""),
                            payload.optString("items_json", "[]")
                    );
                    database.saleDao().insert(sale);

                    // Add to sync queue for cloud upload
                    DatabaseHelper.SyncQueueEntity queue = new DatabaseHelper.SyncQueueEntity(
                            recordUuid, tenantId, packet.optString("branch_id", branchId),
                            table, originDeviceId, timestamp, hash, payload.toString(), 0
                    );
                    database.syncQueueDao().enqueue(queue);

                    notifyRecordSynced(table, recordUuid, peerId);
                    notifyQueueUpdated();
                }
            } else if ("products".equals(table)) {
                DatabaseHelper.ProductEntity existing = database.productDao().getByUuid(recordUuid);
                // Conflict resolution: latest timestamp wins
                if (existing == null || timestamp > existing.timestamp) {
                    DatabaseHelper.ProductEntity product = new DatabaseHelper.ProductEntity(
                            recordUuid,
                            tenantId,
                            packet.optString("branch_id", branchId),
                            originDeviceId,
                            timestamp,
                            "pending",
                            hash,
                            payload.optString("sku", ""),
                            payload.optString("name", ""),
                            payload.optString("category", "General"),
                            payload.optDouble("price", 0.0),
                            payload.optInt("stock_quantity", 0)
                    );
                    database.productDao().insert(product);
                    notifyRecordSynced(table, recordUuid, peerId);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to apply synced record: " + e.getMessage(), e);
        }
    }

    private void handleSyncedAckPacket(String peerId, JSONObject packet) {
        try {
            JSONArray arr = packet.getJSONArray("synced_uuids");
            List<String> uuids = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                uuids.add(arr.getString(i));
            }

            if (!uuids.isEmpty()) {
                database.syncQueueDao().deleteSyncedRecords(uuids);
                database.saleDao().markAsSynced(uuids);
                database.productDao().markAsSynced(uuids);

                if (listener != null) {
                    mainHandler.post(() -> listener.onSyncedAckReceived(uuids));
                }
                notifyQueueUpdated();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling SYNCED_ACK: " + e.getMessage(), e);
        }
    }

    private void handleCatchupRequest(String peerId) {
        try {
            List<DatabaseHelper.SyncQueueEntity> pending = database.syncQueueDao().getPendingForTenant(tenantId);
            for (DatabaseHelper.SyncQueueEntity entity : pending) {
                JSONObject packet = new JSONObject();
                packet.put("packet_id", UUID.randomUUID().toString());
                packet.put("type", "SYNC_RECORD");
                packet.put("tenant_id", tenantId);
                packet.put("branch_id", entity.branchId);
                packet.put("origin_device_id", entity.deviceId);
                packet.put("ttl", 1); // Direct response
                packet.put("table", entity.tableName);
                packet.put("record_uuid", entity.recordUuid);
                packet.put("hash", entity.hash);
                packet.put("timestamp", entity.timestamp);
                packet.put("payload", new JSONObject(entity.payloadJson));

                if (meshManager != null) {
                    meshManager.sendMessageToPeer(peerId, packet.toString());
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error responding to catchup request: " + e.getMessage(), e);
        }
    }

    @Override
    public void onPeerConnected(String peerId) {
        Log.i(TAG, "Peer connected: " + peerId + ". Sending catchup request for tenant " + tenantId);
        try {
            JSONObject req = new JSONObject();
            req.put("packet_id", UUID.randomUUID().toString());
            req.put("type", "REQUEST_CATCHUP");
            req.put("tenant_id", tenantId);
            req.put("branch_id", branchId);
            req.put("origin_device_id", deviceId);
            req.put("ttl", 1);
            if (meshManager != null) {
                meshManager.sendMessageToPeer(peerId, req.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to send catchup request: " + e.getMessage(), e);
        }
    }

    @Override
    public void onPeerDisconnected(String peerId) {
        Log.i(TAG, "Peer disconnected: " + peerId);
    }

    private void notifyRecordSynced(String table, String uuid, String source) {
        if (listener != null) {
            mainHandler.post(() -> listener.onRecordSynced(table, uuid, source));
        }
    }

    private void notifyQueueUpdated() {
        if (listener != null) {
            int pending = database.syncQueueDao().getPendingForTenant(tenantId).size();
            mainHandler.post(() -> listener.onQueueUpdated(pending));
        }
    }

    public void shutdown() {
        isRunning = false;
        engineExecutor.shutdown();
    }
}

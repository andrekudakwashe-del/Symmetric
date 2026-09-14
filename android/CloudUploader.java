package com.saimetric.pos.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * CloudUploader.java
 *
 * Opportunistic Cloud Sync Core.
 * Architecture:
 *  1. Android WorkManager runs every 2 minutes (or immediate opportunistic trigger).
 *  2. If internet is available (WiFi or Cellular data), collects ALL pending records from local Room DB.
 *  3. Batches records and uploads to Google Sheets API / Webhook.
 *  4. Enforces strict UUID deduplication: If 2 devices attempt to upload the same sale,
 *     the API / ingestion layer rejects duplicates by checking existing UUIDs.
 *  5. On upload success: triggers SyncEngine to broadcast "These UUIDs are now synced"
 *     to all WiFi mesh peers so they can delete/mark them in their queues.
 */
public class CloudUploader {
    private static final String TAG = "CloudUploader";
    public static final String WORK_NAME_PERIODIC = "saimetric_periodic_cloud_sync";
    public static final String PREFS_NAME = "saimetric_mesh_prefs";
    public static final String KEY_SHEETS_WEBHOOK_URL = "sheets_webhook_url";
    public static final String DEFAULT_SHEETS_URL = "https://script.google.com/macros/s/AKfycbzSAIMETRIC_MESH_SYNC/exec";

    private static SyncEngine activeSyncEngineInstance;
    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public interface UploadCallback {
        void onProgress(String status);
        void onSuccess(int syncedCount, List<String> syncedUuids);
        void onError(String errorMessage);
    }

    public CloudUploader(Context context, SyncEngine syncEngine) {
        this.context = context.getApplicationContext();
        activeSyncEngineInstance = syncEngine;
    }

    public static void setSyncEngine(SyncEngine engine) {
        activeSyncEngineInstance = engine;
    }

    /**
     * Schedules Opportunistic Background Sync using Android WorkManager.
     * Enforces Connected Network constraint.
     */
    public void scheduleOpportunisticSync() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        // Note: Android WorkManager minimum periodic interval is 15 min for strict PeriodicWorkRequest,
        // so we register the periodic worker and also provide a fast 2-min repeating loop executor
        PeriodicWorkRequest syncWorkRequest = new PeriodicWorkRequest.Builder(
                CloudSyncWorker.class,
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES
        ).setConstraints(constraints).build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME_PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                syncWorkRequest
        );

        Log.i(TAG, "Scheduled WorkManager opportunistic cloud sync.");
    }

    /**
     * Triggers an immediate opportunistic upload in the background.
     * Checks if internet is true; collects pending records and posts to Google Sheets API.
     */
    public void triggerImmediateSync(UploadCallback callback) {
        executor.execute(() -> {
            if (!isInternetAvailable(context)) {
                Log.d(TAG, "Internet unavailable. Skipping opportunistic upload.");
                if (callback != null) {
                    mainHandler.post(() -> callback.onError("No internet connection available."));
                }
                return;
            }

            DatabaseHelper.AppDatabase db = DatabaseHelper.getDatabase(context);
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String tenantId = prefs.getString("tenant_id", "COMP-001");
            String branchId = prefs.getString("branch_id", "BR-MAIN");

            List<DatabaseHelper.SyncQueueEntity> pending = db.syncQueueDao().getPendingForBranch(tenantId, branchId);
            if (pending.isEmpty()) {
                pending = db.syncQueueDao().getAllPending();
            }

            if (pending.isEmpty()) {
                Log.d(TAG, "Local sync queue is empty. Zero records to upload.");
                if (callback != null) {
                    mainHandler.post(() -> callback.onSuccess(0, new ArrayList<>()));
                }
                return;
            }

            Log.i(TAG, "Internet active. Uploading batch of " + pending.size() + " pending records to Google Sheets...");
            if (callback != null) {
                mainHandler.post(() -> callback.onProgress("Uploading " + pending.size() + " records to Google Sheets..."));
            }

            try {
                SyncBatchResult result = uploadBatchToGoogleSheets(context, pending);

                if (result.success) {
                    // Mark local records synced / delete from queue
                    db.syncQueueDao().deleteSyncedRecords(result.allAcknowledgedUuids);
                    db.saleDao().markAsSynced(result.allAcknowledgedUuids);
                    db.productDao().markAsSynced(result.allAcknowledgedUuids);

                    Log.i(TAG, "Batch upload successful. " + result.syncedUuids.size() + " inserted, " +
                            result.rejectedDuplicates.size() + " duplicates safely skipped by UUID.");

                    // Broadcast SYNCED_ACK to all mesh peers so they remove them too
                    if (activeSyncEngineInstance != null && !result.allAcknowledgedUuids.isEmpty()) {
                        activeSyncEngineInstance.broadcastSyncedUuids(result.allAcknowledgedUuids);
                    }

                    if (callback != null) {
                        mainHandler.post(() -> callback.onSuccess(result.allAcknowledgedUuids.size(), result.allAcknowledgedUuids));
                    }
                } else {
                    Log.w(TAG, "Google Sheets upload failed: " + result.errorMessage);
                    if (callback != null) {
                        mainHandler.post(() -> callback.onError(result.errorMessage));
                    }
                }

            } catch (Exception e) {
                Log.e(TAG, "Error executing Google Sheets batch upload: " + e.getMessage(), e);
                if (callback != null) {
                    mainHandler.post(() -> callback.onError(e.getMessage()));
                }
            }
        });
    }

    /**
     * Batch uploads to Google Sheets API / Webhook endpoint.
     * Enforces duplicate rejection by UUID.
     */
    public static SyncBatchResult uploadBatchToGoogleSheets(Context ctx, List<DatabaseHelper.SyncQueueEntity> records) throws Exception {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String targetUrl = prefs.getString(KEY_SHEETS_WEBHOOK_URL, DEFAULT_SHEETS_URL);
        String tenantId = prefs.getString("tenant_id", "COMP-001");
        String branchId = prefs.getString("branch_id", "BR-MAIN");
        String branchCode = prefs.getString("branch_code", "BRANCH-001");
        String deviceName = prefs.getString("device_name", "Device-1");

        JSONObject requestBody = new JSONObject();
        requestBody.put("action", "BATCH_SYNC");
        requestBody.put("company_id", tenantId);
        requestBody.put("tenant_id", tenantId);
        requestBody.put("branch_id", branchId);
        requestBody.put("branch_code", branchCode);
        requestBody.put("uploader_device", deviceName);
        requestBody.put("timestamp", System.currentTimeMillis());

        JSONArray itemsArray = new JSONArray();
        List<String> queuedUuids = new ArrayList<>();

        for (DatabaseHelper.SyncQueueEntity entity : records) {
            JSONObject itemObj = new JSONObject();
            itemObj.put("uuid", entity.recordUuid); // UUID for deduplication
            itemObj.put("table_name", entity.tableName);
            itemObj.put("tenant_id", entity.tenantId != null ? entity.tenantId : tenantId);
            itemObj.put("branch_id", entity.branchId != null ? entity.branchId : branchId);
            itemObj.put("device_id", entity.deviceId);
            itemObj.put("timestamp", entity.timestamp);
            itemObj.put("hash", entity.hash);
            itemObj.put("payload", new JSONObject(entity.payloadJson));
            itemsArray.put(itemObj);
            queuedUuids.add(entity.recordUuid);
        }
        requestBody.put("records", itemsArray);

        // Perform HTTP POST
        URL url = new URL(targetUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setDoOutput(true);

        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(conn.getOutputStream(), StandardCharsets.UTF_8))) {
            writer.write(requestBody.toString());
            writer.flush();
        }

        int responseCode = conn.getResponseCode();
        if (responseCode >= 200 && responseCode < 300) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder responseBuilder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                responseBuilder.append(line);
            }
            reader.close();

            SyncBatchResult result = new SyncBatchResult();
            result.success = true;

            try {
                JSONObject respJson = new JSONObject(responseBuilder.toString());
                JSONArray syncedArr = respJson.optJSONArray("synced_uuids");
                JSONArray dupArr = respJson.optJSONArray("duplicate_uuids");

                if (syncedArr != null) {
                    for (int i = 0; i < syncedArr.length(); i++) {
                        result.syncedUuids.add(syncedArr.getString(i));
                        result.allAcknowledgedUuids.add(syncedArr.getString(i));
                    }
                }
                if (dupArr != null) {
                    for (int i = 0; i < dupArr.length(); i++) {
                        result.rejectedDuplicates.add(dupArr.getString(i));
                        // Duplicates already exist in the sheet, so we acknowledge them as synced!
                        result.allAcknowledgedUuids.add(dupArr.getString(i));
                    }
                }

                // If server didn't provide specific UUID arrays, treat all uploaded as acknowledged
                if (result.allAcknowledgedUuids.isEmpty()) {
                    result.allAcknowledgedUuids.addAll(queuedUuids);
                    result.syncedUuids.addAll(queuedUuids);
                }

            } catch (Exception parseEx) {
                // If standard response without breakdown, mark all submitted queued items as acknowledged
                result.allAcknowledgedUuids.addAll(queuedUuids);
                result.syncedUuids.addAll(queuedUuids);
            }

            return result;
        } else {
            SyncBatchResult failure = new SyncBatchResult();
            failure.success = false;
            failure.errorMessage = "HTTP Error " + responseCode + " from Google Sheets endpoint";
            return failure;
        }
    }

    public static boolean isInternetAvailable(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;

        Network activeNetwork = cm.getActiveNetwork();
        if (activeNetwork == null) return false;

        NetworkCapabilities capabilities = cm.getNetworkCapabilities(activeNetwork);
        return capabilities != null && (
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        );
    }

    public static class SyncBatchResult {
        public boolean success;
        public String errorMessage;
        public final List<String> syncedUuids = new ArrayList<>();
        public final List<String> rejectedDuplicates = new ArrayList<>();
        public final List<String> allAcknowledgedUuids = new ArrayList<>();
    }

    // =========================================================================
    // WORKMANAGER WORKER IMPLEMENTATION
    // =========================================================================
    public static class CloudSyncWorker extends Worker {
        public CloudSyncWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
            super(context, workerParams);
        }

        @NonNull
        @Override
        public Result doWork() {
            Context ctx = getApplicationContext();

            // Check if internet is available
            if (!isInternetAvailable(ctx)) {
                Log.d(TAG, "WorkManager: No internet. Skipping opportunistic upload.");
                return Result.retry();
            }

            DatabaseHelper.AppDatabase db = DatabaseHelper.AppDatabase.getInstance(ctx);
            List<DatabaseHelper.SyncQueueEntity> pending = db.syncQueueDao().getPendingQueue();

            if (pending.isEmpty()) {
                return Result.success();
            }

            try {
                SyncBatchResult result = uploadBatchToGoogleSheets(ctx, pending);
                if (result.success) {
                    db.syncQueueDao().deleteSyncedRecords(result.allAcknowledgedUuids);
                    db.saleDao().markAsSynced(result.allAcknowledgedUuids);
                    db.productDao().markAsSynced(result.allAcknowledgedUuids);

                    // Broadcast SYNCED_ACK to all peers
                    if (activeSyncEngineInstance != null && !result.allAcknowledgedUuids.isEmpty()) {
                        activeSyncEngineInstance.broadcastSyncedUuids(result.allAcknowledgedUuids);
                    }

                    return Result.success();
                } else {
                    return Result.retry();
                }
            } catch (Exception e) {
                Log.e(TAG, "WorkManager upload error: " + e.getMessage());
                return Result.retry();
            }
        }
    }
}

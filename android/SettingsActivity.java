package com.saimetric.pos.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * SettingsActivity.java
 *
 * Dedicated Android Activity for SAIMETRIC Scalable P2P WiFi Mesh Sync.
 * STRICT REQUIREMENT:
 *  Only 2 user settings:
 *    1. Branch Code
 *    2. Device Name
 *
 * Also provides real-time mesh monitoring:
 *  - NSD Service Name: "SAIMETRIC-POS-[branch_code]"
 *  - Live Connected Peer Count (Logs: "Connected to X peers")
 *  - Connected Peer Names list
 *  - Local pending sync queue count
 *  - Immediate Opportunistic Cloud Sync trigger
 */
public class SettingsActivity extends AppCompatActivity {
    private static final String TAG = "SettingsActivity";
    public static final String PREFS_NAME = "saimetric_mesh_prefs";
    public static final String KEY_BRANCH_CODE = "branch_code";
    public static final String KEY_DEVICE_NAME = "device_name";
    public static final String KEY_DEVICE_ID = "device_id";

    // ONLY 2 Setting Inputs
    private EditText etBranchCode;
    private EditText etDeviceName;

    // Status UI Elements
    private TextView tvMeshServiceName;
    private TextView tvConnectedPeersCount;
    private TextView tvConnectedPeersList;
    private TextView tvPendingQueueCount;
    private TextView tvCloudStatus;
    private ProgressBar progressSync;
    private Button btnSaveSettings;
    private Button btnTriggerCloudSync;

    // Core Mesh Services
    private MeshManager meshManager;
    private SyncEngine syncEngine;
    private CloudUploader cloudUploader;
    private DatabaseHelper.AppDatabase database;

    private final ExecutorService backgroundExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Programmatic / Layout initialization
        initializeViews();

        database = DatabaseHelper.AppDatabase.getInstance(this);

        // Load current 2 settings
        loadSettings();

        // Initialize Mesh & Cloud Services
        initMeshServices();

        // Setup Buttons
        btnSaveSettings.setOnClickListener(v -> saveSettings());
        btnTriggerCloudSync.setOnClickListener(v -> performImmediateCloudSync());

        updatePendingCount();
    }

    private void initializeViews() {
        // Build view hierarchy cleanly
        android.widget.ScrollView scrollView = new android.widget.ScrollView(this);
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        layout.setPadding(32, 32, 32, 32);

        // Title
        TextView tvTitle = new TextView(this);
        tvTitle.setText("P2P WiFi Mesh Settings");
        tvTitle.setTextSize(22);
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        tvTitle.setPadding(0, 0, 0, 8);
        layout.addView(tvTitle);

        TextView tvSubtitle = new TextView(this);
        tvSubtitle.setText("Zero Central Server • Auto-Discovery • Epidemic Mesh Sync");
        tvSubtitle.setTextSize(13);
        tvSubtitle.setTextColor(0xFF888888);
        tvSubtitle.setPadding(0, 0, 0, 24);
        layout.addView(tvSubtitle);

        // Setting 1: Branch Code
        TextView lblBranch = new TextView(this);
        lblBranch.setText("1. Branch Code");
        lblBranch.setTextSize(15);
        lblBranch.setTypeface(null, android.graphics.Typeface.BOLD);
        layout.addView(lblBranch);

        etBranchCode = new EditText(this);
        etBranchCode.setHint("e.g. HARARE-01");
        etBranchCode.setSingleLine(true);
        layout.addView(etBranchCode);

        // Setting 2: Device Name
        TextView lblDevice = new TextView(this);
        lblDevice.setText("2. Device Name");
        lblDevice.setTextSize(15);
        lblDevice.setTypeface(null, android.graphics.Typeface.BOLD);
        lblDevice.setPadding(0, 16, 0, 0);
        layout.addView(lblDevice);

        etDeviceName = new EditText(this);
        etDeviceName.setHint("e.g. POS-Terminal-1");
        etDeviceName.setSingleLine(true);
        layout.addView(etDeviceName);

        // Save Button
        btnSaveSettings = new Button(this);
        btnSaveSettings.setText("Save Mesh Settings & Reconnect");
        btnSaveSettings.setBackgroundColor(0xFF6A4DFF);
        btnSaveSettings.setTextColor(0xFFFFFFFF);
        layout.addView(btnSaveSettings);

        // Divider
        View divider = new View(this);
        divider.setBackgroundColor(0xFFDDDDDD);
        android.widget.LinearLayout.LayoutParams divParams = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 2);
        divParams.setMargins(0, 32, 0, 32);
        layout.addView(divider, divParams);

        // Live Mesh Status Section
        TextView tvStatusHeader = new TextView(this);
        tvStatusHeader.setText("Live Mesh & Cloud Status");
        tvStatusHeader.setTextSize(17);
        tvStatusHeader.setTypeface(null, android.graphics.Typeface.BOLD);
        layout.addView(tvStatusHeader);

        tvMeshServiceName = new TextView(this);
        tvMeshServiceName.setText("NSD Service: SAIMETRIC-POS-...");
        tvMeshServiceName.setTextSize(13);
        tvMeshServiceName.setPadding(0, 8, 0, 4);
        layout.addView(tvMeshServiceName);

        tvConnectedPeersCount = new TextView(this);
        tvConnectedPeersCount.setText("Connected to 0 peers");
        tvConnectedPeersCount.setTextSize(15);
        tvConnectedPeersCount.setTextColor(0xFF008800);
        tvConnectedPeersCount.setTypeface(null, android.graphics.Typeface.BOLD);
        tvConnectedPeersCount.setPadding(0, 4, 0, 4);
        layout.addView(tvConnectedPeersCount);

        tvConnectedPeersList = new TextView(this);
        tvConnectedPeersList.setText("No active peer sockets.");
        tvConnectedPeersList.setTextSize(12);
        tvConnectedPeersList.setTextColor(0xFF555555);
        tvConnectedPeersList.setPadding(0, 0, 0, 8);
        layout.addView(tvConnectedPeersList);

        tvPendingQueueCount = new TextView(this);
        tvPendingQueueCount.setText("Pending Sync Queue: 0 records");
        tvPendingQueueCount.setTextSize(13);
        layout.addView(tvPendingQueueCount);

        tvCloudStatus = new TextView(this);
        tvCloudStatus.setText("Cloud Status: Ready (Periodic WorkManager active)");
        tvCloudStatus.setTextSize(13);
        tvCloudStatus.setPadding(0, 4, 0, 8);
        layout.addView(tvCloudStatus);

        progressSync = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressSync.setIndeterminate(true);
        progressSync.setVisibility(View.GONE);
        layout.addView(progressSync);

        btnTriggerCloudSync = new Button(this);
        btnTriggerCloudSync.setText("Force Cloud Sync Now (Google Sheets)");
        layout.addView(btnTriggerCloudSync);

        scrollView.addView(layout);
        setContentView(scrollView);
    }

    private void loadSettings() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String branch = prefs.getString(KEY_BRANCH_CODE, "HARARE-01");
        String device = prefs.getString(KEY_DEVICE_NAME, "POS-Terminal-1");

        etBranchCode.setText(branch);
        etDeviceName.setText(device);
        tvMeshServiceName.setText("NSD Service: SAIMETRIC-POS-" + branch);
    }

    private void initMeshServices() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String branch = prefs.getString(KEY_BRANCH_CODE, "HARARE-01");
        String device = prefs.getString(KEY_DEVICE_NAME, "POS-Terminal-1");
        String deviceId = prefs.getString(KEY_DEVICE_ID, null);

        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
        }

        final String finalDeviceId = deviceId;

        backgroundExecutor.execute(() -> {
            if (meshManager != null) {
                meshManager.stop();
            }

            meshManager = new MeshManager(this, branch, finalDeviceId, device, new MeshManager.MeshEventListener() {
                @Override
                public void onPeerCountChanged(int totalConnectedPeers) {
                    mainHandler.post(() -> {
                        // MANDATORY LOGGING
                        Log.i(TAG, "Connected to " + totalConnectedPeers + " peers");
                        tvConnectedPeersCount.setText("Connected to " + totalConnectedPeers + " peers");
                        updatePeerNamesList();
                    });
                }

                @Override
                public void onPeerConnected(String peerId, String peerName) {
                    mainHandler.post(() -> {
                        Toast.makeText(SettingsActivity.this, "Peer Joined: " + peerName, Toast.LENGTH_SHORT).show();
                        updatePeerNamesList();
                    });
                }

                @Override
                public void onPeerDisconnected(String peerId) {
                    mainHandler.post(() -> updatePeerNamesList());
                }

                @Override
                public void onMessageReceived(String rawMessage, String fromPeerId) {
                    if (syncEngine != null) {
                        syncEngine.onMessageReceived(rawMessage, fromPeerId);
                    }
                }

                @Override
                public void onServiceRegistered(String serviceName, int port) {
                    mainHandler.post(() -> tvMeshServiceName.setText("NSD Service: " + serviceName + " (Port " + port + ")"));
                }
            });

            syncEngine = new SyncEngine(this, finalDeviceId, meshManager, new SyncEngine.SyncListener() {
                @Override
                public void onRecordSynced(String table, String recordUuid, String source) {
                    mainHandler.post(() -> {
                        Toast.makeText(SettingsActivity.this, "Mesh Synced: " + table + " (" + recordUuid.substring(0, 6) + ")", Toast.LENGTH_SHORT).show();
                        updatePendingCount();
                    });
                }

                @Override
                public void onQueueUpdated(int pendingCount) {
                    mainHandler.post(() -> tvPendingQueueCount.setText("Pending Sync Queue: " + pendingCount + " records"));
                }

                @Override
                public void onSyncedAckReceived(List<String> syncedUuids) {
                    mainHandler.post(() -> {
                        Toast.makeText(SettingsActivity.this, "Cloud Ack: " + syncedUuids.size() + " UUIDs acknowledged", Toast.LENGTH_SHORT).show();
                        updatePendingCount();
                    });
                }
            });

            cloudUploader = new CloudUploader(this, syncEngine);
            cloudUploader.scheduleOpportunisticSync();

            meshManager.start();
        });
    }

    private void updatePeerNamesList() {
        if (meshManager == null) return;
        List<String> peers = meshManager.getConnectedPeerNames();
        if (peers.isEmpty()) {
            tvConnectedPeersList.setText("No active peer sockets.");
        } else {
            StringBuilder sb = new StringBuilder("Active Peers:\n");
            for (String p : peers) {
                sb.append(" • ").append(p).append("\n");
            }
            tvConnectedPeersList.setText(sb.toString().trim());
        }
    }

    private void updatePendingCount() {
        backgroundExecutor.execute(() -> {
            int count = database.syncQueueDao().getPendingCount();
            mainHandler.post(() -> tvPendingQueueCount.setText("Pending Sync Queue: " + count + " records"));
        });
    }

    private void saveSettings() {
        String branch = etBranchCode.getText().toString().trim();
        String device = etDeviceName.getText().toString().trim();

        if (branch.isEmpty()) branch = "HARARE-01";
        if (device.isEmpty()) device = "POS-Terminal-1";

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_BRANCH_CODE, branch)
                .putString(KEY_DEVICE_NAME, device)
                .apply();

        Toast.makeText(this, "Saved: " + branch + " / " + device + ". Restarting Mesh...", Toast.LENGTH_SHORT).show();
        tvMeshServiceName.setText("NSD Service: SAIMETRIC-POS-" + branch);

        // Reconnect with new branch / device parameters
        initMeshServices();
    }

    private void performImmediateCloudSync() {
        if (cloudUploader == null) return;
        progressSync.setVisibility(View.VISIBLE);
        tvCloudStatus.setText("Cloud Status: Checking internet and uploading pending queue...");

        cloudUploader.triggerImmediateSync(new CloudUploader.UploadCallback() {
            @Override
            public void onProgress(String status) {
                tvCloudStatus.setText("Cloud Status: " + status);
            }

            @Override
            public void onSuccess(int syncedCount, List<String> syncedUuids) {
                progressSync.setVisibility(View.GONE);
                tvCloudStatus.setText("Cloud Status: Success! Synced & Acked " + syncedCount + " records to Google Sheets.");
                Toast.makeText(SettingsActivity.this, "Cloud Sync Complete! " + syncedCount + " records", Toast.LENGTH_LONG).show();
                updatePendingCount();
            }

            @Override
            public void onError(String errorMessage) {
                progressSync.setVisibility(View.GONE);
                tvCloudStatus.setText("Cloud Status: " + errorMessage);
                Toast.makeText(SettingsActivity.this, "Sync Error: " + errorMessage, Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        updatePendingCount();
        updatePeerNamesList();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (meshManager != null) {
            meshManager.stop();
        }
    }
}

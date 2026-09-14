package com.saimetric.pos.sync;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * MeshManager.java
 *
 * Scalable P2P WiFi Mesh Networking Core.
 *  - Architecture: True Serverless Peer-to-Peer. Every device is Client + Server + Uploader.
 *  - Auto Discovery: Android NSD (Network Service Discovery). Service Name = "SAIMETRIC-POS-[branch_code]"
 *  - Scalability: Loops and thread-safe collections. ZERO hardcoded device limits; natively supports 3 to 50+ devices.
 *  - Logs: "Connected to X peers" upon any peer membership change.
 *  - Fully asynchronous & threaded; never blocks the main UI thread.
 */
public class MeshManager {
    private static final String TAG = "MeshManager";
    public static final String SERVICE_TYPE = "_saimetric-pos._tcp.";

    private final Context context;
    private final String branchCode;
    private final String deviceId;
    private final String deviceName;

    private final NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;
    private String registeredServiceName;

    private ServerSocket serverSocket;
    private int localPort = 0;
    private boolean isRunning = false;

    // Concurrent map storing all active peer connections: Key -> Peer Device ID or Host:Port
    private final ConcurrentHashMap<String, PeerConnection> connectedPeers = new ConcurrentHashMap<>();

    // Thread pools for non-blocking I/O
    private final ExecutorService serverAcceptorExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService networkWorkerPool = Executors.newCachedThreadPool();
    private final ScheduledExecutorService heartbeatScheduler = Executors.newSingleThreadScheduledExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private MeshEventListener listener;

    public interface MeshEventListener {
        void onPeerCountChanged(int totalConnectedPeers);
        void onPeerConnected(String peerId, String peerName);
        void onPeerDisconnected(String peerId);
        void onMessageReceived(String rawMessage, String fromPeerId);
        void onServiceRegistered(String serviceName, int port);
    }

    public MeshManager(Context context, String branchCode, String deviceId, String deviceName, MeshEventListener listener) {
        this.context = context.getApplicationContext();
        this.branchCode = branchCode != null && !branchCode.trim().isEmpty() ? branchCode.trim() : "DEFAULT";
        this.deviceId = deviceId != null ? deviceId : UUID.randomUUID().toString();
        this.deviceName = deviceName != null ? deviceName : "Terminal-" + this.deviceId.substring(0, 4);
        this.listener = listener;
        this.nsdManager = (NsdManager) this.context.getSystemService(Context.NSD_SERVICE);
    }

    public void setListener(MeshEventListener listener) {
        this.listener = listener;
    }

    /**
     * Starts the P2P Mesh:
     * 1. Opens ServerSocket on available port (Every device is a Server)
     * 2. Registers Android NSD service: "SAIMETRIC-POS-[branch_code]"
     * 3. Starts Android NSD discovery to find peers on the same SSID (Every device is a Client)
     * 4. Starts periodic keepalive and mesh health verification
     */
    public synchronized void start() {
        if (isRunning) return;
        isRunning = true;

        Log.i(TAG, "Starting MeshManager for branch: " + branchCode + " [Device: " + deviceName + " / " + deviceId + "]");

        // 1. Initialize local ServerSocket
        try {
            serverSocket = new ServerSocket(0); // Bind to any free port
            localPort = serverSocket.getLocalPort();
            Log.i(TAG, "P2P Server listening on port: " + localPort);
            startServerAcceptorLoop();
        } catch (IOException e) {
            Log.e(TAG, "Failed to start local P2P ServerSocket", e);
            return;
        }

        // 2. Register NSD Service
        registerNsdService();

        // 3. Start NSD Peer Discovery
        discoverPeers();

        // 4. Start Heartbeat Ping Loop (every 8 seconds)
        heartbeatScheduler.scheduleWithFixedDelay(this::performHeartbeatCheck, 5, 8, TimeUnit.SECONDS);
    }

    /**
     * Stop and cleanup all P2P connections, unregister NSD, close sockets.
     */
    public synchronized void stop() {
        if (!isRunning) return;
        isRunning = false;

        Log.i(TAG, "Stopping MeshManager...");

        // Unregister service
        if (registrationListener != null && nsdManager != null) {
            try {
                nsdManager.unregisterService(registrationListener);
            } catch (Exception e) {
                Log.w(TAG, "Error unregistering NSD service: " + e.getMessage());
            }
            registrationListener = null;
        }

        // Stop discovery
        if (discoveryListener != null && nsdManager != null) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception e) {
                Log.w(TAG, "Error stopping NSD discovery: " + e.getMessage());
            }
            discoveryListener = null;
        }

        // Close server socket
        if (serverSocket != null && !serverSocket.isClosed()) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {}
        }

        // Disconnect all peers
        for (PeerConnection peer : connectedPeers.values()) {
            peer.disconnect();
        }
        connectedPeers.clear();
        logPeerCount();
    }

    // =========================================================================
    // SERVER: Accept Incoming Peer Connections
    // =========================================================================
    private void startServerAcceptorLoop() {
        serverAcceptorExecutor.execute(() -> {
            while (isRunning && serverSocket != null && !serverSocket.isClosed()) {
                try {
                    Socket incomingSocket = serverSocket.accept();
                    networkWorkerPool.execute(() -> handleIncomingSocket(incomingSocket));
                } catch (IOException e) {
                    if (!isRunning) break;
                    Log.w(TAG, "ServerSocket accept exception: " + e.getMessage());
                }
            }
        });
    }

    private void handleIncomingSocket(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            socket.setSoTimeout(30000); // 30s read timeout

            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            PrintWriter writer = new PrintWriter(new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8)), true);

            // Send initial Handshake Hello
            JSONObject hello = new JSONObject();
            hello.put("type", "HANDSHAKE");
            hello.put("deviceId", deviceId);
            hello.put("deviceName", deviceName);
            hello.put("branchCode", branchCode);
            hello.put("listenPort", localPort);
            writer.println(hello.toString());

            // Read peer's Handshake response
            String peerHandshakeLine = reader.readLine();
            if (peerHandshakeLine == null) {
                socket.close();
                return;
            }

            JSONObject peerHello = new JSONObject(peerHandshakeLine);
            String peerDeviceId = peerHello.optString("deviceId");
            String peerDevName = peerHello.optString("deviceName", "Unknown");
            String peerBranch = peerHello.optString("branchCode");

            // Validate branch match and not self
            if (deviceId.equals(peerDeviceId) || !branchCode.equalsIgnoreCase(peerBranch)) {
                socket.close();
                return;
            }

            registerPeerConnection(peerDeviceId, peerDevName, socket, reader, writer);

        } catch (Exception e) {
            Log.w(TAG, "Handshake failed on incoming socket: " + e.getMessage());
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    // =========================================================================
    // CLIENT: Connect to Discovered Peer
    // =========================================================================
    public void connectToDiscoveredPeer(InetAddress host, int port, String remoteServiceName) {
        networkWorkerPool.execute(() -> {
            try {
                // Avoid connecting to self
                if (port == localPort && isLocalAddress(host)) {
                    return;
                }

                String endpointKey = host.getHostAddress() + ":" + port;
                if (hasActiveConnectionToHost(host.getHostAddress(), port)) {
                    return;
                }

                Log.d(TAG, "Connecting to discovered peer at " + endpointKey);
                Socket socket = new Socket(host, port);
                socket.setTcpNoDelay(true);
                socket.setKeepAlive(true);
                socket.setSoTimeout(30000);

                BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                PrintWriter writer = new PrintWriter(new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8)), true);

                // Wait for Server's Handshake
                String serverHandshakeLine = reader.readLine();
                if (serverHandshakeLine == null) {
                    socket.close();
                    return;
                }

                JSONObject serverHello = new JSONObject(serverHandshakeLine);
                String peerDeviceId = serverHello.optString("deviceId");
                String peerDevName = serverHello.optString("deviceName");
                String peerBranch = serverHello.optString("branchCode");

                if (deviceId.equals(peerDeviceId) || !branchCode.equalsIgnoreCase(peerBranch)) {
                    socket.close();
                    return;
                }

                // Send our Handshake Reply
                JSONObject ourHello = new JSONObject();
                ourHello.put("type", "HANDSHAKE");
                ourHello.put("deviceId", deviceId);
                ourHello.put("deviceName", deviceName);
                ourHello.put("branchCode", branchCode);
                ourHello.put("listenPort", localPort);
                writer.println(ourHello.toString());

                registerPeerConnection(peerDeviceId, peerDevName, socket, reader, writer);

            } catch (Exception e) {
                Log.d(TAG, "Failed connecting to peer at " + host.getHostAddress() + ":" + port + " (" + e.getMessage() + ")");
            }
        });
    }

    private synchronized void registerPeerConnection(String peerDeviceId, String peerDevName, Socket socket, BufferedReader reader, PrintWriter writer) {
        // If already connected to this device ID, close older socket
        PeerConnection existing = connectedPeers.get(peerDeviceId);
        if (existing != null && existing.isAlive()) {
            existing.disconnect();
        }

        PeerConnection conn = new PeerConnection(peerDeviceId, peerDevName, socket, reader, writer);
        connectedPeers.put(peerDeviceId, conn);
        logPeerCount();

        // Notify listener
        mainHandler.post(() -> {
            if (listener != null) {
                listener.onPeerConnected(peerDeviceId, peerDevName);
                listener.onPeerCountChanged(connectedPeers.size());
            }
        });

        // Start dedicated reader thread for this peer
        networkWorkerPool.execute(conn::startReading);
    }

    // =========================================================================
    // BROADCASTING: Epidemic P2P Dissemination
    // =========================================================================
    /**
     * Broadcasts a JSON message payload to all currently connected peers.
     * Scale-proof: Iterates over thread-safe map without fixed bounds.
     *
     * @param messageJson Payload to broadcast
     * @param excludePeerId Optional peer to exclude (prevents echoing back to sender)
     */
    public void broadcast(String messageJson, String excludePeerId) {
        if (connectedPeers.isEmpty()) {
            Log.d(TAG, "No peers currently connected to broadcast message.");
            return;
        }

        networkWorkerPool.execute(() -> {
            int sentCount = 0;
            for (Map.Entry<String, PeerConnection> entry : connectedPeers.entrySet()) {
                String peerId = entry.getKey();
                if (excludePeerId != null && excludePeerId.equals(peerId)) {
                    continue;
                }
                PeerConnection conn = entry.getValue();
                if (conn.isAlive()) {
                    conn.send(messageJson);
                    sentCount++;
                }
            }
            Log.d(TAG, "Broadcast message dispatched to " + sentCount + " peers.");
        });
    }

    public void broadcast(String messageJson) {
        broadcast(messageJson, null);
    }

    /**
     * Logs the mandatory requirement: "Connected to X peers"
     */
    private void logPeerCount() {
        int count = connectedPeers.size();
        Log.i(TAG, "Connected to " + count + " peers");
        mainHandler.post(() -> {
            if (listener != null) {
                listener.onPeerCountChanged(count);
            }
        });
    }

    public int getConnectedPeerCount() {
        return connectedPeers.size();
    }

    public List<String> getConnectedPeerNames() {
        List<String> names = new ArrayList<>();
        for (PeerConnection c : connectedPeers.values()) {
            if (c.isAlive()) {
                names.add(c.deviceName + " (" + c.deviceId.substring(0, Math.min(6, c.deviceId.length())) + ")");
            }
        }
        return names;
    }

    private boolean hasActiveConnectionToHost(String ip, int port) {
        for (PeerConnection c : connectedPeers.values()) {
            if (c.isAlive() && c.matches(ip, port)) {
                return true;
            }
        }
        return false;
    }

    private boolean isLocalAddress(InetAddress addr) {
        return addr.isLoopbackAddress() || addr.isAnyLocalAddress();
    }

    // =========================================================================
    // ANDROID NETWORK SERVICE DISCOVERY (NSD)
    // =========================================================================
    private void registerNsdService() {
        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        // Mandatory Service Name format: SAIMETRIC-POS-[branch_code]
        String baseName = "SAIMETRIC-POS-" + branchCode;
        serviceInfo.setServiceName(baseName);
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(localPort);

        registrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo nsdServiceInfo) {
                registeredServiceName = nsdServiceInfo.getServiceName();
                Log.i(TAG, "NSD Service registered successfully: " + registeredServiceName + " on port " + localPort);
                mainHandler.post(() -> {
                    if (listener != null) {
                        listener.onServiceRegistered(registeredServiceName, localPort);
                    }
                });
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Log.e(TAG, "NSD Service registration failed with error code: " + errorCode);
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo arg0) {
                Log.i(TAG, "NSD Service unregistered.");
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Log.e(TAG, "NSD Unregistration failed: " + errorCode);
            }
        };

        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener);
        } catch (Exception e) {
            Log.e(TAG, "Failed registering NSD service: " + e.getMessage());
        }
    }

    private void discoverPeers() {
        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "Discovery start failed: Error code: " + errorCode);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "Discovery stop failed: Error code: " + errorCode);
            }

            @Override
            public void onDiscoveryStarted(String serviceType) {
                Log.i(TAG, "Service discovery started for type: " + serviceType);
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                Log.i(TAG, "Discovery stopped: " + serviceType);
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                Log.d(TAG, "Service found: " + serviceInfo.getServiceName());
                String targetPrefix = "SAIMETRIC-POS-" + branchCode;

                // Match service prefix and ignore own service
                if (serviceInfo.getServiceName().contains(targetPrefix)) {
                    if (registeredServiceName != null && serviceInfo.getServiceName().equals(registeredServiceName)) {
                        Log.d(TAG, "Skipping self service resolution.");
                        return;
                    }
                    resolveDiscoveredService(serviceInfo);
                }
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                Log.i(TAG, "Service lost: " + serviceInfo.getServiceName());
            }
        };

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (Exception e) {
            Log.e(TAG, "Failed initiating NSD service discovery: " + e.getMessage());
        }
    }

    private void resolveDiscoveredService(NsdServiceInfo serviceInfo) {
        nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Log.w(TAG, "Resolve failed for " + serviceInfo.getServiceName() + " (" + errorCode + ")");
            }

            @Override
            public void onServiceResolved(NsdServiceInfo resolvedServiceInfo) {
                InetAddress host = resolvedServiceInfo.getHost();
                int port = resolvedServiceInfo.getPort();
                Log.i(TAG, "Resolved peer service: " + resolvedServiceInfo.getServiceName() + " at " + host.getHostAddress() + ":" + port);
                connectToDiscoveredPeer(host, port, resolvedServiceInfo.getServiceName());
            }
        });
    }

    private void performHeartbeatCheck() {
        if (!isRunning) return;
        JSONObject ping = new JSONObject();
        try {
            ping.put("type", "PING");
            ping.put("deviceId", deviceId);
            ping.put("timestamp", System.currentTimeMillis());
            broadcast(ping.toString());
        } catch (Exception ignored) {}
    }

    // =========================================================================
    // PEER CONNECTION INNER CLASS
    // =========================================================================
    private class PeerConnection {
        final String deviceId;
        final String deviceName;
        final Socket socket;
        final BufferedReader reader;
        final PrintWriter writer;
        volatile boolean alive = true;

        PeerConnection(String deviceId, String deviceName, Socket socket, BufferedReader reader, PrintWriter writer) {
            this.deviceId = deviceId;
            this.deviceName = deviceName;
            this.socket = socket;
            this.reader = reader;
            this.writer = writer;
        }

        boolean isAlive() {
            return alive && socket != null && !socket.isClosed() && socket.isConnected();
        }

        boolean matches(String ip, int port) {
            if (socket == null || socket.getInetAddress() == null) return false;
            return socket.getInetAddress().getHostAddress().equals(ip) && socket.getPort() == port;
        }

        void send(String message) {
            if (!isAlive()) return;
            try {
                synchronized (writer) {
                    writer.println(message);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error sending to peer " + deviceName + ": " + e.getMessage());
                disconnect();
            }
        }

        void startReading() {
            try {
                String line;
                while (alive && (line = reader.readLine()) != null) {
                    final String msg = line.trim();
                    if (msg.isEmpty()) continue;

                    // Intercept system pings
                    if (msg.contains("\"type\":\"PING\"")) {
                        continue;
                    }

                    // Dispatch application message to listener
                    if (listener != null) {
                        mainHandler.post(() -> listener.onMessageReceived(msg, deviceId));
                    }
                }
            } catch (IOException e) {
                Log.d(TAG, "Peer read loop closed: " + deviceName + " (" + e.getMessage() + ")");
            } finally {
                disconnect();
            }
        }

        void disconnect() {
            if (!alive) return;
            alive = false;
            try { socket.close(); } catch (IOException ignored) {}
            connectedPeers.remove(deviceId);
            logPeerCount();

            mainHandler.post(() -> {
                if (listener != null) {
                    listener.onPeerDisconnected(deviceId);
                    listener.onPeerCountChanged(connectedPeers.size());
                }
            });
        }
    }
}

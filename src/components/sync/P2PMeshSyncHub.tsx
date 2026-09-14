import React, { useState, useEffect } from 'react';
import {
  meshSyncService,
  MeshEventLog,
  VirtualDevice,
} from '../../services/meshSyncService';
import { P2PMeshPeer } from '../../types';
import {
  Wifi,
  Radio,
  Server,
  Cloud,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Plus,
  Power,
  Globe,
  ShoppingCart,
  Send,
  ShieldCheck,
  Zap,
  Layers,
  ArrowRight,
  Sparkles,
  Info,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  QrCode,
  Share2,
  ExternalLink,
  Laptop,
  Smartphone,
  Tablet,
  Activity,
  BellRing,
  Camera,
  WifiOff,
} from 'lucide-react';
import { ShareDeviceModal } from '../common/ShareDeviceModal';
import { OfflineAirgapSyncModal } from './OfflineAirgapSyncModal';

interface P2PMeshSyncHubProps {
  onBack?: () => void;
}

export const P2PMeshSyncHub: React.FC<P2PMeshSyncHubProps> = ({ onBack }) => {
  // 1. Settings (ONLY 2 Settings + Optional LAN Gateway)
  const [branchCode, setBranchCode] = useState('HARARE-01');
  const [deviceName, setDeviceName] = useState('POS-Terminal-1');
  const [localGatewayUrl, setLocalGatewayUrl] = useState(() => meshSyncService.getLocalGatewayUrl());
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAirgapModal, setShowAirgapModal] = useState(false);
  const [pingSentToast, setPingSentToast] = useState(false);
  const [incomingPingNotice, setIncomingPingNotice] = useState<string | null>(null);
  const [incomingSaleNotice, setIncomingSaleNotice] = useState<string | null>(null);

  // 2. Mesh Live State (Real Physical Devices + Virtual)
  const [peerCount, setPeerCount] = useState<number>(0);
  const [peers, setPeers] = useState<P2PMeshPeer[]>([]);
  const [virtualDevices, setVirtualDevices] = useState<VirtualDevice[]>([]);
  const [logs, setLogs] = useState<MeshEventLog[]>([]);
  const [showSimulationLab, setShowSimulationLab] = useState(false);
  const [connStatus, setConnStatus] = useState(() => meshSyncService.getConnectionStatus());

  // 3. Test Plan State
  const [testRunning, setTestRunning] = useState(false);
  const [testCurrentStep, setTestCurrentStep] = useState<number>(0);
  const [testStepTitle, setTestStepTitle] = useState<string>('');
  const [testStepDetails, setTestStepDetails] = useState<string>('');
  const [testCompleted, setTestCompleted] = useState<boolean | null>(null);

  // Load configuration on mount
  useEffect(() => {
    const cfg = meshSyncService.getConfig();
    setBranchCode(cfg.branchCode);
    setDeviceName(cfg.deviceName);
    setVirtualDevices(meshSyncService.getVirtualDevices());

    const unsubLogs = meshSyncService.subscribeLogs((newLogs) => {
      setLogs(newLogs);
    });

    const unsubPeers = meshSyncService.subscribePeers((count, peerList) => {
      setPeerCount(count);
      setPeers(peerList);
      setVirtualDevices(meshSyncService.getVirtualDevices());
    });

    // Listen for incoming ping/sale events from other physical terminals
    const onMeshPing = (e: any) => {
      const { originName, message } = e.detail || {};
      setIncomingPingNotice(`Ping from ${originName}: "${message}"`);
      setTimeout(() => setIncomingPingNotice(null), 5000);
    };

    const onMeshSale = (e: any) => {
      const { sale, originName } = e.detail || {};
      if (sale) {
        setIncomingSaleNotice(`Sale #${sale.id} ($${(sale.total || 0).toFixed(2)}) synced from ${originName}!`);
        setTimeout(() => setIncomingSaleNotice(null), 6000);
      }
    };

    window.addEventListener('mesh-ping-received', onMeshPing);
    window.addEventListener('mesh-sale-received', onMeshSale);

    const statusTimer = window.setInterval(() => {
      setConnStatus(meshSyncService.getConnectionStatus());
    }, 2500);

    return () => {
      unsubLogs();
      unsubPeers();
      clearInterval(statusTimer);
      window.removeEventListener('mesh-ping-received', onMeshPing);
      window.removeEventListener('mesh-sale-received', onMeshSale);
    };
  }, []);

  // Save the settings
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    meshSyncService.saveConfig(branchCode, deviceName);
    meshSyncService.setLocalGatewayUrl(localGatewayUrl);
    setSettingsSavedToast(true);
    setTimeout(() => setSettingsSavedToast(false), 3000);
  };

  // Send Live Test Ping to all physical devices
  const handleSendPing = async () => {
    setPingSentToast(true);
    await meshSyncService.sendTestPing();
    setTimeout(() => setPingSentToast(false), 4000);
  };

  // Trigger Sale on a Virtual Device
  const handleMakeSale = (deviceId: string) => {
    const amount = Math.floor(20 + Math.random() * 80);
    meshSyncService.makeSaleOnDevice(deviceId, amount);
    setVirtualDevices(meshSyncService.getVirtualDevices());
  };

  // Toggle power on/off for device
  const handleTogglePower = (deviceId: string) => {
    meshSyncService.toggleDeviceOnline(deviceId);
    setVirtualDevices(meshSyncService.getVirtualDevices());
  };

  // Toggle internet on/off for device
  const handleToggleInternet = (deviceId: string) => {
    meshSyncService.toggleDeviceInternet(deviceId);
    setVirtualDevices(meshSyncService.getVirtualDevices());
  };

  // Trigger Opportunistic Cloud Sync manually
  const handleCloudSync = async (deviceId: string) => {
    await meshSyncService.triggerOpportunisticCloudSync(deviceId);
    setVirtualDevices(meshSyncService.getVirtualDevices());
  };

  // Add new device (scale up to 50)
  const handleAddDevice = () => {
    meshSyncService.addVirtualDevice();
    setVirtualDevices(meshSyncService.getVirtualDevices());
  };

  // Reset cluster
  const handleResetCluster = () => {
    meshSyncService.initVirtualMeshDefault();
    setVirtualDevices(meshSyncService.getVirtualDevices());
    setTestCompleted(null);
    setTestCurrentStep(0);
  };

  // Execute Official Test Plan
  const handleRunOfficialTestPlan = async () => {
    setTestRunning(true);
    setTestCompleted(null);
    try {
      const success = await meshSyncService.executeOfficialTestPlan((step, title, details) => {
        setTestCurrentStep(step);
        setTestStepTitle(title);
        setTestStepDetails(details);
        setVirtualDevices(meshSyncService.getVirtualDevices());
      });
      setTestCompleted(success);
    } catch (e) {
      console.error(e);
      setTestCompleted(false);
    } finally {
      setTestRunning(false);
      setVirtualDevices(meshSyncService.getVirtualDevices());
    }
  };

  // Other physical devices connected (excluding self)
  const otherPeers = peers.filter((p) => !p.isThisDevice);
  const thisDevice = peers.find((p) => p.isThisDevice);

  return (
    <div className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* INCOMING NOTICES (TOASTS) */}
      {incomingPingNotice && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center justify-between border border-emerald-400/50 animate-bounce">
          <div className="flex items-center space-x-3">
            <BellRing className="w-5 h-5 text-emerald-200" />
            <span className="text-sm font-bold">{incomingPingNotice}</span>
          </div>
          <span className="text-xs bg-emerald-950/60 px-2 py-0.5 rounded-full font-mono">Live Mesh</span>
        </div>
      )}

      {incomingSaleNotice && (
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center justify-between border border-purple-400/50 animate-bounce">
          <div className="flex items-center space-x-3">
            <ShoppingCart className="w-5 h-5 text-purple-200" />
            <span className="text-sm font-bold">{incomingSaleNotice}</span>
          </div>
          <span className="text-xs bg-purple-950/60 px-2 py-0.5 rounded-full font-mono">Synced to Room DB</span>
        </div>
      )}

      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#181135] via-[#241457] to-[#120a2e] border border-purple-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#6A4DFF]/15 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2">
              <span className="p-2 rounded-xl bg-[#6A4DFF]/20 text-[#6A4DFF] border border-[#6A4DFF]/40">
                <Wifi className="w-6 h-6 animate-pulse" />
              </span>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>P2P WiFi Mesh Network</span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border ${
                    otherPeers.length > 0
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}>
                    {otherPeers.length > 0 ? `${otherPeers.length + 1} Terminals Synchronized` : '1 Terminal Online (Ready)'}
                  </span>
                </h1>
                <p className="text-xs text-purple-200/70 font-mono">
                  Branch: <strong className="text-white">{branchCode}</strong> • Every sale &amp; stock movement syncs between terminals in real time
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {onBack && (
              <button
                type="button"
                id="btn-mesh-back"
                onClick={onBack}
                className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700"
              >
                Back to POS
              </button>
            )}

            {/* SEND TEST PING BUTTON */}
            <button
              type="button"
              id="btn-send-live-ping"
              onClick={handleSendPing}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-black flex items-center space-x-1.5 shadow-lg shadow-purple-600/25 transition border border-purple-400/40 cursor-pointer"
              title="Broadcast a live ping packet to all connected devices"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{pingSentToast ? 'Ping Sent!' : 'Send Test Ping'}</span>
            </button>

            {/* OFFLINE QR & AIR-GAP SYNC */}
            <button
              type="button"
              id="btn-offline-airgap-sync"
              onClick={() => setShowAirgapModal(true)}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center space-x-1.5 transition border border-amber-500/40 shadow-sm cursor-pointer"
              title="Zero-internet air-gapped sync via camera & QR code"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Offline QR Sync</span>
            </button>

            {/* CONNECT DEVICE (QR CODE) */}
            <button
              type="button"
              id="btn-mesh-share-devices"
              onClick={() => setShowShareModal(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center space-x-1.5 transition border border-emerald-500/40 shadow-sm cursor-pointer"
              title="Get Public Link & QR Code for other devices"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Connect Device (QR)</span>
            </button>

            {/* OPEN 2ND TAB */}
            <button
              type="button"
              id="btn-open-second-terminal"
              onClick={() => window.open(window.location.href, '_blank')}
              className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
              title="Open a second terminal in a new tab to test sync immediately"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open 2nd Terminal</span>
            </button>
          </div>
        </div>

        {/* REAL-TIME RELAY & PEER COUNT STATUS BADGES */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-purple-500/20">
          <div className="bg-black/30 rounded-2xl p-3 border border-purple-500/20">
            <div className="text-[11px] font-mono text-purple-300 uppercase tracking-wider">Branch Identifier</div>
            <div className="text-sm font-black text-white font-mono mt-0.5 truncate">
              {branchCode}
            </div>
          </div>
          <div className="bg-black/30 rounded-2xl p-3 border border-purple-500/20">
            <div className="text-[11px] font-mono text-purple-300 uppercase tracking-wider">Mesh Status</div>
            <div className={`text-sm font-black font-mono mt-0.5 flex items-center gap-1.5 ${
              otherPeers.length > 0 ? 'text-emerald-400' : 'text-amber-300'
            }`}>
              <span className={`w-2.5 h-2.5 rounded-full inline-block ${
                otherPeers.length > 0 ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
              }`} />
              <span>{otherPeers.length > 0 ? `${otherPeers.length} Terminal(s) Linked` : 'Waiting for Terminal 2'}</span>
            </div>
          </div>
          <div className="bg-black/30 rounded-2xl p-3 border border-purple-500/20">
            <div className="text-[11px] font-mono text-purple-300 uppercase tracking-wider">Mesh Transport</div>
            <div className="text-xs font-bold text-emerald-300 font-mono mt-0.5 flex items-center gap-1 truncate">
              <span className={`w-2 h-2 rounded-full ${
                connStatus.isWebRtcConnected
                  ? 'bg-purple-400'
                  : connStatus.isMqttConnected
                  ? 'bg-emerald-400'
                  : 'bg-amber-400'
              }`} />
              <span>{
                connStatus.isWebRtcConnected
                  ? 'Direct Local Wi-Fi (WebRTC)'
                  : connStatus.isMqttConnected
                  ? 'Realtime WebSocket Mesh'
                  : 'Offline Local Room Engine'
              }</span>
            </div>
          </div>
          <div className="bg-black/30 rounded-2xl p-3 border border-purple-500/20">
            <div className="text-[11px] font-mono text-purple-300 uppercase tracking-wider">Network Mode</div>
            <div className={`text-xs font-black font-mono mt-0.5 flex items-center gap-1.5 ${
              connStatus.isOnline ? 'text-emerald-300' : 'text-amber-300'
            }`}>
              {connStatus.isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{connStatus.isOnline ? 'Online Cloud Relay' : '100% Offline (LAN & QR)'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: REAL PHYSICAL DEVICES IN THIS BRANCH */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <span>Active Physical Terminals in {branchCode}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/40">
                  {otherPeers.length + 1} Device{otherPeers.length + 1 === 1 ? '' : 's'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Any sale created on one device immediately decrements stock and updates totals across all terminals
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Another Device</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card: This Terminal */}
          <div className="bg-slate-950/80 border-2 border-[#6A4DFF]/60 rounded-2xl p-4 relative overflow-hidden shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-[#6A4DFF]/20 text-[#6A4DFF]">
                  <Laptop className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-black text-white font-mono">{deviceName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#6A4DFF]/30 text-purple-200 font-bold border border-[#6A4DFF]/40">
                      THIS TERMINAL
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">Branch: {branchCode}</span>
                </div>
              </div>
              <span className="flex items-center space-x-1.5 text-xs text-emerald-400 font-bold bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Active</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-800 text-xs">
              <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div className="text-[10px] font-mono text-slate-400">Local Sales Count</div>
                <div className="text-base font-black text-white font-mono mt-0.5">
                  {thisDevice?.totalSalesCount ?? 0}
                </div>
              </div>
              <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div className="text-[10px] font-mono text-slate-400">Offline Sync Queue</div>
                <div className="text-base font-black text-emerald-400 font-mono mt-0.5">
                  {thisDevice?.pendingCount ?? 0}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-1">
              <span className="font-mono text-[11px]">Hardware UUID: {thisDevice?.id || 'LOCAL-NODE'}</span>
              <button
                type="button"
                onClick={handleSendPing}
                className="text-xs text-[#6A4DFF] hover:text-purple-300 font-bold flex items-center space-x-1 hover:underline cursor-pointer"
              >
                <Activity className="w-3 h-3" />
                <span>Send Ping</span>
              </button>
            </div>
          </div>

          {/* Cards for other connected physical devices */}
          {otherPeers.map((peer, idx) => (
            <div
              key={peer.id}
              className="bg-slate-950/80 border-2 border-emerald-500/40 rounded-2xl p-4 relative overflow-hidden shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                    {peer.deviceType === 'tablet' ? (
                      <Tablet className="w-5 h-5" />
                    ) : peer.deviceType === 'mobile' ? (
                      <Smartphone className="w-5 h-5" />
                    ) : (
                      <Laptop className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-black text-white font-mono">{peer.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 font-bold border border-emerald-500/40 uppercase">
                        {peer.deviceType || 'Peer'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{peer.ip ? `IP: ${peer.ip}` : 'WiFi Mesh'}</span>
                  </div>
                </div>
                <span className="flex items-center space-x-1.5 text-xs text-emerald-400 font-bold bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>Synchronized</span>
                </span>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                <span className="text-[11px] font-mono">Heartbeat: Active &lt; 3s ago</span>
                <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Instant Sync Active
                </span>
              </div>
            </div>
          ))}

          {/* Empty State / Connection Prompt when only 1 device is on */}
          {otherPeers.length === 0 && (
            <div className="bg-slate-950/40 border-2 border-dashed border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center text-center space-y-3">
              <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Smartphone className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Connect Terminal 2 (Phone, Tablet, or PC)</h3>
                <p className="text-xs text-slate-400 max-w-sm mt-1">
                  Scan the QR code or open the link on your second device with Branch <strong>{branchCode}</strong> to see them link automatically!
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowShareModal(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Scan QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.open(window.location.href, '_blank')}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center space-x-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Test in New Tab</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION: SETTINGS (ONLY 2 SETTINGS: Branch Code, Device Name) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-[#6A4DFF]" />
            <h2 className="text-base font-black text-white">Terminal Identity &amp; Branch Matching</h2>
          </div>
          {settingsSavedToast && (
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/40 animate-fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Settings Saved &amp; Mesh Reconnected
            </span>
          )}
        </div>

        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          {/* Setting 1: Branch Code */}
          <div>
            <label className="block text-xs font-mono font-bold text-slate-400 mb-1">
              1. Branch Code (Must match)
            </label>
            <input
              type="text"
              id="input-mesh-branch-code"
              value={branchCode}
              onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
              placeholder="e.g. HARARE-01"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono focus:border-[#6A4DFF] focus:outline-none transition"
              required
            />
          </div>

          {/* Setting 2: Device Name */}
          <div>
            <label className="block text-xs font-mono font-bold text-slate-400 mb-1">
              2. Terminal Identifier
            </label>
            <input
              type="text"
              id="input-mesh-device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. POS-Terminal-1"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono focus:border-[#6A4DFF] focus:outline-none transition"
              required
            />
          </div>

          {/* Setting 3: Optional Offline LAN Server / Hotspot IP */}
          <div>
            <label className="block text-xs font-mono font-bold text-slate-400 mb-1">
              3. Offline LAN Server IP (Optional)
            </label>
            <input
              type="text"
              id="input-mesh-lan-gateway"
              value={localGatewayUrl}
              onChange={(e) => setLocalGatewayUrl(e.target.value)}
              placeholder="e.g. http://192.168.43.1:3000"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono focus:border-[#6A4DFF] focus:outline-none transition"
            />
          </div>

          {/* Save Button */}
          <div>
            <button
              type="submit"
              id="btn-save-mesh-settings"
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-indigo-600 hover:opacity-90 text-white text-xs font-black shadow-md transition cursor-pointer"
            >
              Save &amp; Reconnect Mesh
            </button>
          </div>
        </form>

        {/* Quick presets */}
        <div className="flex items-center space-x-2 mt-3 pt-3 border-t border-slate-800 text-xs">
          <span className="text-slate-400">Quick Branch Presets:</span>
          {['HARARE-01', 'BULAWAYO-01', 'MUTARE-01'].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setBranchCode(preset);
                meshSyncService.saveConfig(preset, deviceName);
                setSettingsSavedToast(true);
                setTimeout(() => setSettingsSavedToast(false), 3000);
              }}
              className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border transition ${
                branchCode === preset
                  ? 'bg-purple-950/80 border-purple-500 text-purple-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* SECTION: LIVE EVENT LEDGER */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-black text-white">Live WiFi Mesh Event Ledger</h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {logs.length} events logged
          </span>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 max-h-[300px] overflow-y-auto space-y-2 font-mono text-xs">
          {logs.length === 0 && (
            <div className="text-center py-10 text-slate-500">
              Listening for mesh packets &amp; discovery events...
            </div>
          )}

          {logs.map((log) => {
            let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
            if (log.type === 'BROADCAST') badgeColor = 'bg-purple-900/60 text-purple-300 border-purple-700';
            if (log.type === 'EPIDEMIC_HOP') badgeColor = 'bg-indigo-900/60 text-indigo-300 border-indigo-700';
            if (log.type === 'CONFLICT_RESOLVED') badgeColor = 'bg-emerald-900/60 text-emerald-300 border-emerald-700';
            if (log.type === 'CLOUD_SYNC') badgeColor = 'bg-blue-900/60 text-blue-300 border-blue-700';
            if (log.type === 'ACK') badgeColor = 'bg-teal-900/60 text-teal-300 border-teal-700';
            if (log.type === 'DISCOVERY') badgeColor = 'bg-amber-900/60 text-amber-300 border-amber-700';

            return (
              <div
                key={log.id}
                className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className={`px-2 py-0.5 rounded border font-bold ${badgeColor}`}>
                    {log.type}
                  </span>
                  <span className="text-slate-500">{log.timestamp}</span>
                </div>

                <p className="text-slate-200 text-[11px] leading-relaxed break-words">
                  {log.message}
                </p>

                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                  <span>Source: {log.sourceDevice}</span>
                  {log.ttl !== undefined && (
                    <span className="px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                      TTL={log.ttl}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* COLLAPSIBLE ACCORDION: SIMULATION LAB & 6-STAGE OFFICIAL TEST PLAN */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <span>Virtual Stress Lab &amp; Automated 6-Stage Test Plan</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono font-bold border border-purple-500/30">
                  Scale to 50 Virtual Nodes
                </span>
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                Simulate multiple terminals on a single screen without needing physical hardware
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSimulationLab(!showSimulationLab)}
            className="text-xs font-bold text-purple-300 hover:text-white flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 transition cursor-pointer"
          >
            <span>{showSimulationLab ? 'Hide Lab' : 'Open Virtual Lab & Test Plan'}</span>
            {showSimulationLab ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {showSimulationLab && (
          <div className="space-y-6 pt-4 border-t border-slate-800 animate-fadeIn">
            {/* OFFICIAL TEST PLAN HARNESS */}
            <div className="bg-gradient-to-br from-indigo-950/70 via-slate-900 to-purple-950/60 border-2 border-indigo-500/40 rounded-2xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-mono font-black border border-indigo-500/30">
                      Automated Test Plan
                    </span>
                    <span className="text-xs text-slate-400 font-mono">Official Validation</span>
                  </div>
                  <h3 className="text-base font-black text-white mt-1">
                    Automated 6-Stage Mesh &amp; Cloud Sync Test Plan
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5 max-w-2xl">
                    1. Add Dev 1,2,3 → 2. Make 3 sales on 1 → 3. Add Dev 4 &amp; verify sync of all 3 old sales → 4. Turn off 1,2 → 5. Sale on 3,4 → 6. Turn on Internet on 4 &amp; verify Cloud Sync.
                  </p>
                </div>

                <div>
                  <button
                    type="button"
                    id="btn-run-official-test-plan"
                    disabled={testRunning}
                    onClick={handleRunOfficialTestPlan}
                    className={`px-5 py-3 rounded-2xl font-black text-xs flex items-center space-x-2 shadow-xl transition cursor-pointer ${
                      testRunning
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/20'
                    }`}
                  >
                    <Play className={`w-4 h-4 ${testRunning ? 'animate-spin' : ''}`} />
                    <span>{testRunning ? 'Running Plan...' : 'Run 6-Stage Test Plan'}</span>
                  </button>
                </div>
              </div>

              {/* TEST STEP PROGRESS */}
              {testCurrentStep > 0 && (
                <div className="mt-4 pt-4 border-t border-indigo-500/30">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-indigo-300 font-bold">
                      Stage {testCurrentStep} of 6: {testStepTitle}
                    </span>
                    {testCompleted === true && (
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> All 6 Stages Passed!
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-1">{testStepDetails}</p>
                </div>
              )}
            </div>

            {/* VIRTUAL NODES CONTROLS */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-white">
                  Virtual Nodes ({virtualDevices.filter((d) => d.isOnline).length} Active)
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleResetCluster}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-bold transition flex items-center space-x-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddDevice}
                  className="px-3 py-1.5 rounded-xl bg-[#6A4DFF] hover:bg-[#583cd6] text-white text-xs font-bold transition flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add Node</span>
                </button>
              </div>
            </div>

            {/* VIRTUAL NODES GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {virtualDevices.slice(0, 6).map((device, idx) => {
                const pendingCount = device.pendingQueue.length;
                const salesCount = device.sales.length;

                return (
                  <div
                    key={device.id}
                    className={`rounded-2xl p-3.5 border transition ${
                      device.isOnline
                        ? 'bg-slate-900/90 border-slate-800'
                        : 'bg-slate-950/60 border-slate-900 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            device.isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                        <span className="text-xs font-black text-white font-mono">{device.name}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => handleTogglePower(device.id)}
                          className={`p-1 rounded text-xs transition ${
                            device.isOnline ? 'text-emerald-300 bg-emerald-950/60' : 'text-slate-500 bg-slate-800'
                          }`}
                          title="Toggle Power"
                        >
                          <Power className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={!device.isOnline}
                          onClick={() => handleToggleInternet(device.id)}
                          className={`p-1 rounded text-xs transition ${
                            device.hasInternet ? 'text-blue-300 bg-blue-950/60' : 'text-slate-500 bg-slate-800'
                          }`}
                          title="Toggle Internet"
                        >
                          <Globe className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800 text-[11px]">
                      <div>Sales: <strong className="text-white">{salesCount}</strong></div>
                      <div>Queue: <strong className="text-amber-300">{pendingCount}</strong></div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 mt-2.5">
                      <button
                        type="button"
                        disabled={!device.isOnline}
                        onClick={() => handleMakeSale(device.id)}
                        className="py-1 px-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 text-[11px] font-bold border border-purple-500/30 transition disabled:opacity-40"
                      >
                        + Sale
                      </button>
                      <button
                        type="button"
                        disabled={!device.isOnline || !device.hasInternet || pendingCount === 0}
                        onClick={() => handleCloudSync(device.id)}
                        className="py-1 px-2 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 text-[11px] font-bold border border-blue-500/30 transition disabled:opacity-40"
                      >
                        Sync
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Share & Connect Other Devices Modal */}
      <ShareDeviceModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        onOpenAirgapModal={() => setShowAirgapModal(true)}
      />

      {/* Offline Airgap & Optical QR Sync Modal */}
      <OfflineAirgapSyncModal
        isOpen={showAirgapModal}
        onClose={() => setShowAirgapModal(false)}
        branchCode={branchCode}
      />
    </div>
  );
};

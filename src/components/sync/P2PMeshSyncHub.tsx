import React, { useState, useEffect } from 'react';
import {
  meshSyncService,
  MeshEventLog,
  VirtualDevice,
} from '../../services/meshSyncService';
import { P2PMeshPeer } from '../../types';
import {
  getBranches,
  getCurrentBranchId,
  setCurrentBranchId,
  getCurrentCompanyId,
  getCurrentCompany,
  saveInventoryItem,
  addAuditLog,
} from '../../db/roomDatabase';
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
  ShieldAlert,
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
  Building2,
  Package,
  FileCheck,
  Lock,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { ShareDeviceModal } from '../common/ShareDeviceModal';
import { OfflineAirgapSyncModal } from './OfflineAirgapSyncModal';

interface P2PMeshSyncHubProps {
  onBack?: () => void;
}

export const P2PMeshSyncHub: React.FC<P2PMeshSyncHubProps> = ({ onBack }) => {
  // 1. Settings & Auto-Detected Tenant / Branch
  const [branchCode, setBranchCode] = useState('HARARE-01');
  const [deviceName, setDeviceName] = useState('POS-Terminal-1');
  const [localGatewayUrl, setLocalGatewayUrl] = useState(() => meshSyncService.getLocalGatewayUrl());
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);
  const [testActionToast, setTestActionToast] = useState<string | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAirgapModal, setShowAirgapModal] = useState(false);
  const [pingSentToast, setPingSentToast] = useState(false);
  const [incomingPingNotice, setIncomingPingNotice] = useState<string | null>(null);
  const [incomingSaleNotice, setIncomingSaleNotice] = useState<string | null>(null);
  const [incomingAckNotice, setIncomingAckNotice] = useState<string | null>(null);

  // 2. Mesh Live State & Auto-Detection
  const [peerCount, setPeerCount] = useState<number>(0);
  const [peers, setPeers] = useState<P2PMeshPeer[]>([]);
  const [virtualDevices, setVirtualDevices] = useState<VirtualDevice[]>([]);
  const [logs, setLogs] = useState<MeshEventLog[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'sales' | 'inventory' | 'approvals' | 'ack' | 'drops'>('all');
  const [showSimulationLab, setShowSimulationLab] = useState(false);
  const [connStatus, setConnStatus] = useState(() => meshSyncService.getConnectionStatus());
  const [branchesList, setBranchesList] = useState(() => getBranches());

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
    setBranchesList(getBranches());

    const unsubLogs = meshSyncService.subscribeLogs((newLogs) => {
      setLogs(newLogs);
    });

    const unsubPeers = meshSyncService.subscribePeers((count, peerList) => {
      setPeerCount(count);
      setPeers(peerList);
      setVirtualDevices(meshSyncService.getVirtualDevices());
    });

    // Listen for incoming ping/sale/ack events from other physical terminals
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

    const onMeshAck = (e: any) => {
      const { originName, count } = e.detail || {};
      setIncomingAckNotice(`Cloud Post ACK: ${originName} uploaded ${count || 1} records to Apps Script. Marked SYNCED locally!`);
      setTimeout(() => setIncomingAckNotice(null), 6000);
    };

    window.addEventListener('mesh-ping-received', onMeshPing);
    window.addEventListener('mesh-sale-received', onMeshSale);
    window.addEventListener('mesh-sync-receipt-received', onMeshAck);

    const statusTimer = window.setInterval(() => {
      setConnStatus(meshSyncService.getConnectionStatus());
      setBranchesList(getBranches());
    }, 2500);

    return () => {
      unsubLogs();
      unsubPeers();
      clearInterval(statusTimer);
      window.removeEventListener('mesh-ping-received', onMeshPing);
      window.removeEventListener('mesh-sale-received', onMeshSale);
      window.removeEventListener('mesh-sync-receipt-received', onMeshAck);
    };
  }, []);

  // Save the settings
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    meshSyncService.saveConfig(
      branchCode,
      deviceName,
      connStatus.companyId,
      connStatus.branchId,
      connStatus.branchName,
      connStatus.autoDetectTenantBranch
    );
    meshSyncService.setLocalGatewayUrl(localGatewayUrl);
    setSettingsSavedToast(true);
    setTimeout(() => setSettingsSavedToast(false), 3000);
  };

  // Switch roaming branch directly
  const handleSelectBranch = (brId: string) => {
    setCurrentBranchId(brId);
    meshSyncService.syncContextWithActiveSession(true);
    const updatedStatus = meshSyncService.getConnectionStatus();
    setConnStatus(updatedStatus);
    setBranchCode(updatedStatus.branchCode);
    setTestActionToast(`Switched active branch to ${updatedStatus.branchName} (${updatedStatus.branchCode}). Mesh recalibrated.`);
    setTimeout(() => setTestActionToast(null), 4000);
  };

  // Send Live Test Ping to all physical devices
  const handleSendPing = async () => {
    setPingSentToast(true);
    await meshSyncService.sendTestPing();
    setTimeout(() => setPingSentToast(false), 4000);
  };

  // Broadcast sample Inventory Change over mesh
  const handleTestBroadcastInventory = () => {
    const item = saveInventoryItem({
      itemId: `PRD-${Date.now().toString().slice(-4)}`,
      itemName: `Demo Mesh Item ${new Date().toLocaleTimeString()}`,
      category: 'Beverages',
      costPerUnit: 1.2,
      costPerCase: 28.8,
      sellPriceUnit: 2.0,
      sellPriceCase: 48.0,
      stockSingles: 48,
      stockCases: 2,
      totalUnits: 96,
      unitsPerCase: 24,
      reorderLevelCases: 1,
      reorderLevelUnits: 24,
      sku: `SKU-MESH-${Math.floor(100 + Math.random() * 900)}`,
      barcode: `6001${Math.floor(1000000 + Math.random() * 9000000)}`,
    });
    setTestActionToast(`Product "${item.itemName}" created & broadcasted to WiFi mesh!`);
    setTimeout(() => setTestActionToast(null), 4000);
  };

  // Broadcast sample Supervisor Approval over mesh
  const handleTestSupervisorApproval = () => {
    addAuditLog({
      action: 'DISCOUNT_OVERRIDE',
      severity: 'WARNING',
      staffId: 'MGR-001',
      staffName: 'Branch Supervisor',
      staffRole: 'SUPERVISOR',
      authorizedById: 'MGR-001',
      authorizedByName: 'Branch Supervisor',
      authorizedByRole: 'SUPERVISOR',
      details: `Manager approved 20% discount override for Customer (PIN Authorized at ${new Date().toLocaleTimeString()})`,
      amount: 15.5,
      referenceId: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
    });
    setTestActionToast('Supervisor PIN Override approved & broadcasted across WiFi mesh!');
    setTimeout(() => setTestActionToast(null), 4000);
  };

  // Broadcast sample Apps Script Sync Receipt (Anti-Double-Posting)
  const handleTestSyncReceipt = () => {
    const fakeRequestId = `req_receipt_${Date.now()}`;
    meshSyncService.broadcastSyncReceipt({
      postedClientRequestIds: [fakeRequestId],
      postedIds: [`sync_${Date.now()}`],
      sheetName: 'Sales',
    });
    setTestActionToast('Cloud Upload ACK broadcasted! Peer devices marked records as SYNCED to prevent double posting.');
    setTimeout(() => setTestActionToast(null), 4500);
  };

  const [clearingQueue, setClearingQueue] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);

  // Clear cloud sync queue
  const handleClearCloudQueue = async () => {
    setClearingQueue(true);
    try {
      await meshSyncService.clearAllSyncQueues();
      setConnStatus(meshSyncService.getConnectionStatus());
      setTestActionToast('All records in cloud sync queue cleared successfully!');
    } catch (e: any) {
      setTestActionToast(`Error clearing queue: ${e?.message || 'Failed'}`);
    } finally {
      setClearingQueue(false);
      setTimeout(() => setTestActionToast(null), 4000);
    }
  };

  // Test cloud sync with live Google Sheet
  const handleTestCloudSync = async () => {
    setTestingCloud(true);
    try {
      const res = await meshSyncService.testCloudSync();
      setConnStatus(meshSyncService.getConnectionStatus());
      if (res.success) {
        setTestActionToast(`Cloud Sync ONLINE: Google Sheets connection verified (${res.durationMs}ms)!`);
      } else {
        setTestActionToast(`Cloud Sync Warning: ${res.message}`);
      }
    } catch (e: any) {
      setTestActionToast(`Cloud test error: ${e?.message || 'Failed'}`);
    } finally {
      setTestingCloud(false);
      setTimeout(() => setTestActionToast(null), 5000);
    }
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

            {/* TEST CLOUD SYNC */}
            <button
              type="button"
              id="btn-test-cloud-sync"
              onClick={handleTestCloudSync}
              disabled={testingCloud}
              className="px-3.5 py-2 rounded-xl bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-bold flex items-center space-x-1.5 transition border border-blue-400/40 shadow-sm cursor-pointer disabled:opacity-50"
              title="Verify active connection to Google Sheets master webhook"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingCloud ? 'animate-spin' : ''}`} />
              <span>{testingCloud ? 'Testing...' : 'Test Cloud Sync'}</span>
            </button>

            {/* CLEAR CLOUD SYNC QUEUE */}
            <button
              type="button"
              id="btn-clear-cloud-queue"
              onClick={handleClearCloudQueue}
              disabled={clearingQueue}
              className="px-3.5 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/70 text-red-200 text-xs font-bold flex items-center space-x-1.5 transition border border-red-800 shadow-sm cursor-pointer disabled:opacity-50"
              title="Clear all pending sync queue items from terminal storage"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>{clearingQueue ? 'Clearing...' : 'Clear Sync Queue'}</span>
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

      {/* Action Notification Toasts */}
      {testActionToast && (
        <div className="fixed top-16 right-4 z-50 p-4 rounded-2xl bg-indigo-950/95 border-2 border-indigo-500 text-white text-xs font-bold shadow-2xl flex items-center space-x-2 animate-bounce">
          <Sparkles className="w-4 h-4 text-indigo-300" />
          <span>{testActionToast}</span>
        </div>
      )}
      {incomingAckNotice && (
        <div className="fixed top-28 right-4 z-50 p-4 rounded-2xl bg-teal-950/95 border-2 border-teal-500 text-teal-200 text-xs font-bold shadow-2xl flex items-center space-x-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-teal-300" />
          <span>{incomingAckNotice}</span>
        </div>
      )}

      {/* SECTION: AUTO-DETECTED TENANT & BRANCH WITH STRICT ISOLATION */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-white">Active Tenant &amp; Branch Isolation</h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Strict Isolation Active
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                P2P mesh strictly prevents cross-tenant leaks and prevents roaming users from polluting wrong branches.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <button
              type="button"
              onClick={() => {
                const nextVal = !connStatus.autoDetectTenantBranch;
                meshSyncService.setAutoDetectTenantBranch(nextVal);
                setConnStatus(meshSyncService.getConnectionStatus());
                setTestActionToast(`Auto-detect Tenant & Branch set to ${nextVal ? 'ON (Recommended)' : 'MANUAL'}`);
                setTimeout(() => setTestActionToast(null), 3000);
              }}
              className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold border transition flex items-center space-x-1.5 cursor-pointer ${
                connStatus.autoDetectTenantBranch
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Auto-Detect: {connStatus.autoDetectTenantBranch ? 'LOCKED & SYNCED' : 'MANUAL OVERRIDE'}</span>
            </button>
          </div>
        </div>

        {/* Current Identity Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Authenticated Tenant</span>
            <div className="text-sm font-bold text-white flex items-center justify-between">
              <span>{connStatus.companyName || 'Saimetric Tenant'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                {connStatus.companyId}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Terminals from other tenants on this Wi-Fi are automatically dropped.</p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Active Branch Station</span>
            <div className="text-sm font-bold text-white flex items-center justify-between">
              <span>{connStatus.branchName || 'Main Branch'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                {connStatus.branchCode}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Branch ID: {connStatus.branchId}</p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Terminal ID &amp; Type</span>
            <div className="text-sm font-bold text-white flex items-center justify-between">
              <span>{connStatus.deviceName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
                {connStatus.deviceId}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Channel: {connStatus.companyId}_{connStatus.branchId}</p>
          </div>
        </div>

        {/* Roaming Multi-Branch Switcher */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold text-slate-400 flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Multi-Branch Roaming Access: Switch Branch Station</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Auto-rebinds P2P mesh &amp; prevents wrong branch population
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {branchesList.map((br) => {
              const bId = br.branchId || br.id || (br as any).branch_id || 'BR-MAIN';
              const bCode = br.code || (br as any).branch_code || 'HQ-01';
              const isSelected = connStatus.branchId === bId || connStatus.branchCode === bCode;
              return (
                <button
                  key={bId}
                  type="button"
                  onClick={() => handleSelectBranch(bId)}
                  className={`px-3 py-2 rounded-xl font-mono text-xs font-bold border transition flex items-center space-x-2 cursor-pointer ${
                    isSelected
                      ? 'bg-purple-950/90 border-purple-500 text-purple-200 shadow-md ring-1 ring-purple-500/40'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-purple-400' : 'text-slate-500'}`} />
                  <span>{br.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-bold">
                    {bCode}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Manual Terminal Override Form */}
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end pt-3 border-t border-slate-800">
          <div>
            <label className="block text-xs font-mono font-bold text-slate-400 mb-1">
              Terminal Identifier
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

          <div>
            <label className="block text-xs font-mono font-bold text-slate-400 mb-1">
              Branch Code Override
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

          <div>
            <label className="block text-xs font-mono font-bold text-slate-400 mb-1">
              Offline LAN Host IP (Optional)
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

          <div>
            <button
              type="submit"
              id="btn-save-mesh-settings"
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-indigo-600 hover:opacity-90 text-white text-xs font-black shadow-md transition cursor-pointer"
            >
              Update &amp; Rebind Mesh
            </button>
          </div>
        </form>

        {/* WHOLE DATABASE SHARING & ANTI-DOUBLE-POSTING VERIFICATION BUTTONS */}
        <div className="pt-3 border-t border-slate-800">
          <div className="text-xs font-mono font-bold text-slate-400 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Full Database P2P Mesh Sharing &amp; Anti-Double-Posting Verification</span>
            </span>
            <span className="text-[10px] text-slate-500">Test live replication across terminals without internet</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={handleSendPing}
              className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-amber-400" />
              <span>Send Live Ping</span>
            </button>

            <button
              type="button"
              onClick={handleTestBroadcastInventory}
              className="px-3 py-2 rounded-xl bg-purple-950/40 hover:bg-purple-900/50 border border-purple-700 text-purple-200 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Package className="w-3.5 h-3.5 text-purple-400" />
              <span>Share Inventory Change</span>
            </button>

            <button
              type="button"
              onClick={handleTestSupervisorApproval}
              className="px-3 py-2 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 border border-amber-700 text-amber-200 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              <span>Share Supervisor Approval</span>
            </button>

            <button
              type="button"
              onClick={handleTestSyncReceipt}
              className="px-3 py-2 rounded-xl bg-teal-950/40 hover:bg-teal-900/50 border border-teal-700 text-teal-200 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <FileCheck className="w-3.5 h-3.5 text-teal-400" />
              <span>Simulate Cloud Post ACK</span>
            </button>

            <button
              type="button"
              onClick={handleTestCloudSync}
              disabled={testingCloud}
              className="px-3 py-2 rounded-xl bg-blue-950/40 hover:bg-blue-900/50 border border-blue-700 text-blue-200 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${testingCloud ? 'animate-spin' : ''}`} />
              <span>Test Cloud Sync Status</span>
            </button>

            <button
              type="button"
              onClick={handleClearCloudQueue}
              disabled={clearingQueue}
              className="px-3 py-2 rounded-xl bg-red-950/40 hover:bg-red-900/50 border border-red-800 text-red-200 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Clear Cloud Sync Queue</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION: LIVE EVENT LEDGER WITH FILTER TABS */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-black text-white">Live WiFi Mesh Event Ledger</h2>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono">
            {[
              { id: 'all', label: `All (${logs.length})` },
              { id: 'sales', label: 'Sales' },
              { id: 'inventory', label: 'Inventory' },
              { id: 'approvals', label: 'Approvals & Staff' },
              { id: 'ack', label: 'Cloud Post ACKs' },
              { id: 'drops', label: 'Security Drops' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLogFilter(tab.id as any)}
                className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  logFilter === tab.id
                    ? 'bg-[#6A4DFF] text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 max-h-[320px] overflow-y-auto space-y-2 font-mono text-xs">
          {logs.length === 0 && (
            <div className="text-center py-10 text-slate-500">
              Listening for mesh packets &amp; discovery events...
            </div>
          )}

          {logs
            .filter((log) => {
              if (logFilter === 'all') return true;
              if (logFilter === 'sales') return log.type === 'BROADCAST' || log.message.toLowerCase().includes('sale');
              if (logFilter === 'inventory') return log.message.toLowerCase().includes('inventory') || log.message.toLowerCase().includes('product');
              if (logFilter === 'approvals') return log.message.toLowerCase().includes('supervisor') || log.message.toLowerCase().includes('staff') || log.message.toLowerCase().includes('approval');
              if (logFilter === 'ack') return log.type === 'ACK' || log.type === 'CLOUD_SYNC' || log.message.toLowerCase().includes('ack') || log.message.toLowerCase().includes('double-posting');
              if (logFilter === 'drops') return log.type === 'SECURITY_DROP' || log.message.toLowerCase().includes('blocked');
              return true;
            })
            .map((log) => {
              let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
              if (log.type === 'BROADCAST') badgeColor = 'bg-purple-900/60 text-purple-300 border-purple-700';
              if (log.type === 'EPIDEMIC_HOP') badgeColor = 'bg-indigo-900/60 text-indigo-300 border-indigo-700';
              if (log.type === 'CONFLICT_RESOLVED') badgeColor = 'bg-emerald-900/60 text-emerald-300 border-emerald-700';
              if (log.type === 'CLOUD_SYNC') badgeColor = 'bg-blue-900/60 text-blue-300 border-blue-700';
              if (log.type === 'ACK') badgeColor = 'bg-teal-900/60 text-teal-200 border-teal-600 font-black';
              if (log.type === 'DISCOVERY') badgeColor = 'bg-amber-900/60 text-amber-300 border-amber-700';
              if (log.type === 'SECURITY_DROP') badgeColor = 'bg-rose-950 text-rose-300 border-rose-700 font-bold';

              return (
                <div
                  key={log.id}
                  className={`p-2.5 rounded-xl border space-y-1 transition ${
                    log.type === 'SECURITY_DROP'
                      ? 'bg-rose-950/30 border-rose-800/80'
                      : log.type === 'ACK'
                      ? 'bg-teal-950/30 border-teal-800/80'
                      : 'bg-slate-900/80 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className={`px-2 py-0.5 rounded border font-bold ${badgeColor}`}>
                      {log.type === 'SECURITY_DROP' ? '🛡️ SECURITY DROP' : log.type === 'ACK' ? '✅ ANTI-DOUBLE-POST ACK' : log.type}
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

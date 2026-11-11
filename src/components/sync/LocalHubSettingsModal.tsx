import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Wifi,
  WifiOff,
  Radio,
  Server,
  Camera,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  QrCode,
  Copy,
  Check,
  Zap,
  Globe,
  Smartphone,
  Layers,
  ArrowRight,
  Shield,
  Activity,
  Download,
  Code2,
  Terminal,
  FileCode,
  CheckCheck,
  Search,
  Sparkles,
  Calendar,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { LocalHubConfig, normalizeHubUrl, LocalHubTestResult } from '../../utils/localHubConfig';
import { meshSyncService, MeshConnectionMode } from '../../services/meshSyncService';
import { OfflineQRCode } from '../common/OfflineQRCode';
import {
  getTermuxHubCode,
  getTermuxHubHeredocCode,
  downloadTermuxHubFile,
  copyTermuxHubCodeToClipboard,
  TERMUX_HUB_VERSION,
  TERMUX_HUB_FILENAME,
} from '../../utils/termuxHubScript';

interface LocalHubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'connect' | 'host' | 'code' | 'sync';
}

export const LocalHubSettingsModal: React.FC<LocalHubSettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'connect',
}) => {
  const [hubUrlInput, setHubUrlInput] = useState<string>(() => LocalHubConfig.getLocalHubUrl());
  const [forceLocalHub, setForceLocalHub] = useState<boolean>(() => LocalHubConfig.getForceLocalHub());
  const [activeTab, setActiveTab] = useState<'connect' | 'host' | 'code' | 'sync'>(initialTab);

  // Script download & copy states
  const [scriptCode, setScriptCode] = useState<string>('');
  const [isLoadingScript, setIsLoadingScript] = useState<boolean>(false);
  const [scriptCopied, setScriptCopied] = useState<boolean>(false);
  const [oneLinerCopied, setOneLinerCopied] = useState<boolean>(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [codeSearchQuery, setCodeSearchQuery] = useState<string>('');

  // Live connection status from meshSyncService
  const [connStatus, setConnStatus] = useState(() => meshSyncService.getConnectionStatus());
  const [connMode, setConnMode] = useState<MeshConnectionMode>(() => meshSyncService.getConnectionMode());

  // Testing status
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LocalHubTestResult | null>(null);

  // QR Scanning
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRegionId = 'local-hub-qr-scanner';
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Clipboard copy
  const [copied, setCopied] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  // Hub Branch Identity & Reset Modal
  const [hubBranchId, setHubBranchId] = useState<string | null>(() => LocalHubConfig.getHubBranchId());
  const [hubBranchName, setHubBranchName] = useState<string | null>(() => LocalHubConfig.getHubBranchName());
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);
  const [isResettingHub, setIsResettingHub] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    setHubUrlInput(LocalHubConfig.getLocalHubUrl());
    setForceLocalHub(LocalHubConfig.getForceLocalHub());
    setConnStatus(meshSyncService.getConnectionStatus());
    setConnMode(meshSyncService.getConnectionMode());
    setHubBranchId(LocalHubConfig.getHubBranchId());
    setHubBranchName(LocalHubConfig.getHubBranchName());

    const unsubMode = meshSyncService.subscribeConnectionMode((mode, details) => {
      setConnMode(mode);
      setConnStatus(meshSyncService.getConnectionStatus());
      setHubBranchId(LocalHubConfig.getHubBranchId());
      setHubBranchName(LocalHubConfig.getHubBranchName());
    });

    const unsubConfig = LocalHubConfig.subscribe(() => {
      setHubUrlInput(LocalHubConfig.getLocalHubUrl());
      setForceLocalHub(LocalHubConfig.getForceLocalHub());
      setHubBranchId(LocalHubConfig.getHubBranchId());
      setHubBranchName(LocalHubConfig.getHubBranchName());
    });

    getTermuxHubHeredocCode().then((code) => {
      if (code) setScriptCode(code);
    });

    return () => {
      unsubMode();
      unsubConfig();
      stopCamera();
    };
  }, [isOpen]);

  const handleConfirmResetHub = async () => {
    setIsResettingHub(true);
    try {
      meshSyncService.resetHubIdentity();
      setShowResetConfirmModal(false);
      setHubBranchId(null);
      setHubBranchName(null);
      setSaveSuccessNotice('Local Hub identity reset command sent. Memory cleared; return to Scan to Connect state.');
      setTimeout(() => setSaveSuccessNotice(null), 5000);
      setActiveTab('connect');
    } finally {
      setIsResettingHub(false);
    }
  };

  const stopCamera = async () => {
    setIsScanning(false);
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch {}
      html5QrCodeRef.current = null;
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    setIsScanning(true);

    try {
      if (html5QrCodeRef.current) {
        try {
          await html5QrCodeRef.current.stop();
        } catch {}
      }

      const qr = new Html5Qrcode(scannerRegionId, { verbose: false });
      html5QrCodeRef.current = qr;

      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decodedText) => {
          await stopCamera();
          const cleanUrl = normalizeHubUrl(decodedText);
          setHubUrlInput(cleanUrl);
          LocalHubConfig.setLocalHubUrl(cleanUrl);
          meshSyncService.connectLocalHub(cleanUrl);
          setSaveSuccessNotice(`Connected to scanned Hub: ${cleanUrl}`);
          setTimeout(() => setSaveSuccessNotice(null), 4000);
        },
        () => {}
      );
    } catch (err: any) {
      setIsScanning(false);
      setCameraError('Camera access unavailable. Please type or paste the Hub WebSocket URL below.');
    }
  };

  const handleApplyUrl = (customUrl?: string) => {
    const target = customUrl || hubUrlInput;
    const clean = LocalHubConfig.setLocalHubUrl(target);
    setHubUrlInput(clean);
    meshSyncService.connectLocalHub(clean);
    setSaveSuccessNotice(`Hub URL updated to: ${clean}`);
    setTimeout(() => setSaveSuccessNotice(null), 3000);
  };

  const handleToggleForceLocalHub = () => {
    const next = !forceLocalHub;
    setForceLocalHub(next);
    LocalHubConfig.setForceLocalHub(next);
    meshSyncService.evaluateConnectionPriority();
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await LocalHubConfig.testHubConnection(hubUrlInput, 4000);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err?.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopy = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadScript = async () => {
    setIsLoadingScript(true);
    try {
      await downloadTermuxHubFile();
      setDownloadNotice('termux-hub.js downloaded successfully! Ready to run on Termux.');
      setTimeout(() => setDownloadNotice(null), 5000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingScript(false);
    }
  };

  const handleCopyFullScript = async () => {
    setIsLoadingScript(true);
    try {
      const res = await copyTermuxHubCodeToClipboard(true);
      if (res.success) {
        setScriptCopied(true);
        setSaveSuccessNotice(`Copied in Termux 'cat << EOF' format! Ready to paste into Termux (${res.lineCount.toLocaleString()} lines).`);
        setTimeout(() => setScriptCopied(false), 3500);
        setTimeout(() => setSaveSuccessNotice(null), 5000);
      }
    } finally {
      setIsLoadingScript(false);
    }
  };

  const handleCopyOneLiner = () => {
    const cmd = 'pkg update -y && pkg install nodejs -y && npm install ws && node termux-hub.js --port 8080';
    handleCopy(cmd);
    setOneLinerCopied(true);
    setTimeout(() => setOneLinerCopied(false), 3000);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-hub-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl flex flex-col text-slate-100">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-5 bg-slate-900/95 backdrop-blur-md border-b border-slate-800">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <h2 id="local-hub-modal-title" className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>Local WebSocket Hub</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold uppercase">
                  Termux / Hotspot
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Zero-internet master-spoke sync for offline Android phones &amp; tills
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Status Pill Bar */}
        <div className="p-4 sm:p-5 pb-0">
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="relative">
                {connMode === 'CLOUD_MESH' ? (
                  <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
                ) : connMode === 'LOCAL_HUB' ? (
                  <div className="w-3.5 h-3.5 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)] animate-pulse" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.8)] animate-ping" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black tracking-wider uppercase">
                    {connMode === 'CLOUD_MESH' && '🟢 Online (Cloud)'}
                    {connMode === 'LOCAL_HUB' && '🔵 Local Hub Connected'}
                    {connMode === 'LOCAL_OFFLINE' && '🟡 Local Offline (Queueing)'}
                    {connMode === 'CLOUD_ONLY' && '🟠 Cloud-Only Mode (Hub Isolated)'}
                  </span>
                  {forceLocalHub && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold">
                      FORCED LOCAL
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                  {connMode === 'LOCAL_HUB'
                    ? `Master Node: ${connStatus.localHubUrl}${hubBranchName ? ` • ${hubBranchName} (${hubBranchId})` : ''}`
                    : connMode === 'CLOUD_ONLY'
                    ? `Isolated from ${hubBranchName || hubBranchId || 'Local'} Hub. Syncing directly to central cloud.`
                    : connMode === 'CLOUD_MESH'
                    ? 'Cloud mesh active. Fallback to Local Hub ready.'
                    : connStatus.isLocalHubLost
                    ? 'Local Hub lost. Scanning for new hub every 5s...'
                    : 'Queuing sales & changes in Room DB.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  meshSyncService.requestCatchUpSync(undefined, undefined, false, true);
                  setSaveSuccessNotice('Syncing all 30-day transactions with Local Hub & terminals...');
                  setTimeout(() => setSaveSuccessNotice(null), 4000);
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition flex items-center gap-1.5 active:scale-95 cursor-pointer"
                title="Force delta catch-up synchronization of all sales, stock, and registers"
              >
                <Zap className="w-3.5 h-3.5 text-indigo-200" />
                <span>Sync All Data</span>
              </button>
              <button
                type="button"
                onClick={() => meshSyncService.reconnectLocalHub()}
                className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reconnect</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tab Toggle: Connect (Client) vs Host (QR Display) vs Termux Code vs Sync Manager */}
        <div className="px-4 sm:px-5 pt-4">
          <div className="grid grid-cols-4 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs font-bold gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('connect');
                stopCamera();
              }}
              className={`py-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'connect'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('host');
                stopCamera();
              }}
              className={`py-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'host'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Host QR</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('code');
                stopCamera();
                if (!scriptCode) {
                  getTermuxHubHeredocCode().then((c) => setScriptCode(c));
                }
              }}
              className={`py-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 relative ${
                activeTab === 'code'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-300" />
              <span>Code</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('sync');
                stopCamera();
              }}
              className={`py-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'sync'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sync Mgr</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Connect to Hub */}
        {activeTab === 'connect' && (
          <div className="p-4 sm:p-5 space-y-4">
            {/* Success toast if recently saved */}
            {saveSuccessNotice && (
              <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{saveSuccessNotice}</span>
              </div>
            )}

            {/* QR Scanner Section */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Scan Host QR Code</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Point camera at host phone or manager display to pair instantly
                  </p>
                </div>
                {!isScanning ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow transition flex items-center gap-1.5 active:scale-95 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Open Camera</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow transition flex items-center gap-1.5 active:scale-95 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Stop Camera</span>
                  </button>
                )}
              </div>

              {cameraError && (
                <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              )}

              {isScanning && (
                <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-indigo-500/50 bg-black flex flex-col items-center justify-center p-2 min-h-[220px]">
                  <div id={scannerRegionId} className="w-full max-w-[280px]" />
                  <p className="text-[11px] text-slate-400 mt-2 font-medium animate-pulse">
                    Scanning for Local Hub QR code...
                  </p>
                </div>
              )}
            </div>

            {/* Manual Hub URL & Test Connection */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
              <label htmlFor="hub-url-input" className="block text-xs font-black uppercase tracking-wider text-slate-300">
                Hub WebSocket URL or IP
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="hub-url-input"
                  type="text"
                  value={hubUrlInput}
                  onChange={(e) => setHubUrlInput(e.target.value)}
                  placeholder="ws://192.168.43.1:8080"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplyUrl()}
                    className="flex-1 sm:flex-none text-xs font-bold px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition active:scale-95 shadow cursor-pointer"
                  >
                    Save &amp; Connect
                  </button>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="flex-1 sm:flex-none text-xs font-bold px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isTesting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                        <span>Testing...</span>
                      </>
                    ) : (
                      <>
                        <Activity className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Test Connection</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mr-1">
                  Presets:
                </span>
                {[
                  'ws://192.168.43.1:8080',
                  'ws://192.168.1.100:8080',
                  'ws://10.0.0.1:8080',
                  'ws://localhost:8080',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setHubUrlInput(preset);
                      handleApplyUrl(preset);
                    }}
                    className="text-[10px] font-mono px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {/* Test Result Display */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                    testResult.success
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                      : 'bg-rose-500/15 border-rose-500/30 text-rose-200'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold">
                      {testResult.success
                        ? `Connection Successful! Latency: ${testResult.latencyMs}ms`
                        : 'Connection Test Failed'}
                    </p>
                    <p className="text-[11px] opacity-90 mt-0.5">
                      {testResult.success
                        ? 'The Local Hub responded promptly. Real-time master-spoke sync is functional.'
                        : testResult.error}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Force Local Hub Toggle */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                    Force Local Hub Mode
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    Testing
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Bypasses Cloud Mesh and forces all packets strictly through the Local WebSocket Hub.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={forceLocalHub}
                onClick={handleToggleForceLocalHub}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  forceLocalHub ? 'bg-indigo-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    forceLocalHub ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Tethered Hub Identity & Repurposing */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                    Tethered Hub Identity
                  </span>
                  {hubBranchId && hubBranchId !== 'UNASSIGNED' ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                      {hubBranchId}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      Unassigned
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {hubBranchName ? `Assigned Branch: ${hubBranchName}` : 'Hardware not yet paired to a specific branch.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowResetConfirmModal(true)}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 transition flex items-center gap-1.5 active:scale-95 cursor-pointer self-start sm:self-auto"
                title="Wipe Local Hub memory to repurpose hardware for a new branch or tenant"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>Reset Hub Identity</span>
              </button>
            </div>

            {/* Architecture Explainer */}
            <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-500/20 text-xs text-indigo-200/90 space-y-1.5">
              <p className="font-bold text-indigo-200 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span>Zero-Internet Master-Spoke Protection</span>
              </p>
              <ul className="list-disc list-inside text-[11px] space-y-1.5 text-slate-300">
                <li>
                  <strong>100% Data Parity:</strong> Syncs sales, live inventory, cash lifts, Form 3 customer change ledgers, credit sales, direct GRVs, expenses, custody accounts, and reconciliations locally without internet.
                </li>
                <li>
                  <strong>Bi-directional Delta Catch-Up:</strong> Auto-reconciles all missed transactions upon connecting or when tapping "Sync All Data".
                </li>
                <li>
                  <strong>Anti-Double-Counting:</strong> Packet envelopes check origin device ID. Originating devices silently ignore their own echoes.
                </li>
                <li>
                  <strong>Auto-Failover &amp; Heartbeat:</strong> Heartbeats run every 10s. If the local host walks away, seamless offline queueing activates with 5s auto-reconnect.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 2: Host Mode QR Code */}
        {activeTab === 'host' && (
          <div className="p-4 sm:p-5 space-y-4 text-center">
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-sm font-bold text-white">Share Hub WebSocket URL</h3>
              <p className="text-xs text-slate-400">
                Display this QR code on the Termux Android host phone so all other shop tills can scan and connect.
              </p>
            </div>

            <div className="flex justify-center p-4 bg-white rounded-3xl w-fit mx-auto shadow-xl">
              <OfflineQRCode
                value={hubUrlInput}
                size={220}
              />
            </div>

            <div className="max-w-md mx-auto flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
              <span className="truncate text-slate-300 mr-2">{hubUrlInput}</span>
              <button
                type="button"
                onClick={() => handleCopy(hubUrlInput)}
                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 shrink-0 transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Quick Termux Code Card */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-950/80 to-slate-900 border border-indigo-500/30 text-left space-y-3 max-w-md mx-auto shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-white">Termux Android Host Code</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                  v3.2 Latest
                </span>
              </div>
              
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Run this high-reliability Node.js hub on an Android phone via Termux. Includes <strong>FIPS 180-4 SHA-256 PIN Security</strong>, <strong>Blind Double-Count Stocktake Vault</strong>, and <strong>Catch-Up Sync</strong>:
              </p>

              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900/90 border border-slate-800">
                <code className="font-mono text-[11px] text-indigo-300 select-all truncate mr-2">
                  node termux-hub.js --port 8080
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('node termux-hub.js --port 8080')}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition cursor-pointer shrink-0"
                >
                  Copy
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadScript}
                  disabled={isLoadingScript}
                  className="w-full text-xs font-bold py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .js</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyFullScript}
                  disabled={isLoadingScript}
                  className="w-full text-xs font-bold py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {scriptCopied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{scriptCopied ? 'Copied All!' : 'Copy Code'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('code');
                  if (!scriptCode) {
                    getTermuxHubHeredocCode().then((c) => setScriptCode(c));
                  }
                }}
                className="w-full text-[11px] font-bold text-center text-indigo-400 hover:text-indigo-300 py-1 transition cursor-pointer flex items-center justify-center gap-1"
              >
                <span>View Full Source Code &amp; Termux Guide</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Termux Hub Code & Full Source Inspector */}
        {activeTab === 'code' && (
          <div className="p-4 sm:p-5 space-y-4">
            {/* Notice Banners */}
            {downloadNotice && (
              <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{downloadNotice}</span>
              </div>
            )}
            {saveSuccessNotice && (
              <div className="p-3 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-medium flex items-center gap-2 animate-in fade-in">
                <CheckCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>{saveSuccessNotice}</span>
              </div>
            )}

            {/* Hero / Download Header Card */}
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-950 border border-indigo-500/30 space-y-3.5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-white flex items-center gap-1.5">
                      <Terminal className="w-4 h-4 text-indigo-400" />
                      <span>Termux Android Local Hub</span>
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                      v3.2 Latest
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                      SHA-256 Auth
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Authoritative offline store server. Runs natively in Termux Node.js with zero dependencies other than <code>ws</code>.
                  </p>
                </div>

                <div className="text-right text-[11px] font-mono text-slate-400 shrink-0">
                  <div className="text-slate-200 font-bold">1,275 Lines</div>
                  <div>~55.8 KB CommonJS</div>
                </div>
              </div>

              {/* Action Buttons: Download & Copy */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadScript}
                  disabled={isLoadingScript}
                  className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Download termux-hub.js</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyFullScript}
                  disabled={isLoadingScript}
                  className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-200 border border-slate-700 text-xs font-black flex items-center justify-center gap-2 shadow transition cursor-pointer disabled:opacity-50"
                >
                  {scriptCopied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
                  <span>{scriptCopied ? "Copied in cat << 'EOF' format!" : "Copy Code (cat << 'EOF' format)"}</span>
                </button>
              </div>
            </div>

            {/* Quick 1-Command Launcher Box */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>One-Command Setup &amp; Launch</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Termux Bash</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Paste this into Termux on the host phone to install Node.js, fetch the package, and start the hub:
              </p>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <code className="font-mono text-xs text-indigo-300 select-all truncate mr-2">
                  pkg update -y &amp;&amp; pkg install nodejs -y &amp;&amp; npm install ws &amp;&amp; node termux-hub.js --port 8080
                </code>
                <button
                  type="button"
                  onClick={handleCopyOneLiner}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer shrink-0 flex items-center gap-1"
                >
                  {oneLinerCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{oneLinerCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Integrity & Updates Checklist */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Verification: In Line with Latest Updates</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  All Systems Verified
                </span>
              </div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">FIPS 180-4 SHA-256 PIN Security:</strong> Plain-text PINs are stripped before network transmission or disk writes. Staff and casual workers are stored and verified with salted SHA-256 hashes.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Blind Double-Count Stocktake Vault:</strong> Team A counts are sealed in private hub memory; Team B count triggers automated server comparison and variance alerts.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Full 16-Domain Store &amp; Delta Catchup:</strong> Real-time replay of sales, direct GRVs, inventory, cash lifts, customer change (Form 3), credit sales, movements, expenses, custody transfers, EOD closures, staff, and customers.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Strict Anti-Echo &amp; Origin Filtering:</strong> Origin device checks eliminate packet echo loops and prevent any double-counting of invoices or cash movements.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">2GB CCTV Protection &amp; 30-Day Auto-Rotation:</strong> Prevents low-spec Android phones from running out of disk space during high-volume sales days.
                  </div>
                </li>
              </ul>
            </div>

            {/* Step-by-Step Android Termux Guide */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
              <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                <span>Step-by-Step Android Termux Setup Guide</span>
              </span>
              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-indigo-300 font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                  <p><strong className="text-slate-200">Open Termux:</strong> Launch Termux on the host Android phone.</p>
                </div>
                <div className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-indigo-300 font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                  <p><strong className="text-slate-200">Paste in Termux:</strong> Tap <em>Copy Code (cat &lt;&lt; 'EOF' format)</em> above or below, paste directly into Termux terminal, and hit Enter. The file <code>termux-hub.js</code> will be written automatically!</p>
                </div>
                <div className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-indigo-300 font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                  <p><strong className="text-slate-200">Turn on Portable Hotspot:</strong> Enable Wi-Fi Hotspot on the host phone. The default IP is <code>192.168.43.1</code>.</p>
                </div>
                <div className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-indigo-300 font-bold flex items-center justify-center shrink-0 text-[10px]">4</span>
                  <p><strong className="text-slate-200">Start the Server:</strong> Run <code>node termux-hub.js --port 8080</code>. All shop tills can now connect instantly!</p>
                </div>
              </div>
            </div>

            {/* Interactive Source Code Inspector */}
            <div className="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-900 border-b border-slate-800 gap-2">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-white">Termux Code: cat &lt;&lt; 'EOF' &gt; termux-hub.js</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    {scriptCode ? `${scriptCode.split('\n').length} lines` : 'Loading...'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Search inside script */}
                  <div className="relative">
                    <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={codeSearchQuery}
                      onChange={(e) => setCodeSearchQuery(e.target.value)}
                      placeholder="Search code..."
                      className="bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32 sm:w-40"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyFullScript}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    {scriptCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{scriptCopied ? 'Copied' : "Copy (cat << 'EOF')"}</span>
                  </button>
                </div>
              </div>

              {/* Code viewer container */}
              <div className="max-h-[360px] overflow-y-auto p-3 font-mono text-[11px] text-slate-300 leading-relaxed bg-black/90 select-all whitespace-pre">
                {scriptCode ? (
                  codeSearchQuery ? (
                    scriptCode
                      .split('\n')
                      .filter((line) => line.toLowerCase().includes(codeSearchQuery.toLowerCase()))
                      .join('\n') || `// No matching lines found for "${codeSearchQuery}"`
                  ) : (
                    scriptCode
                  )
                ) : (
                  <div className="py-8 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                    <span>Loading termux-hub.js source code...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Sync Manager (Catalog & Transaction Recovery) */}
        {activeTab === 'sync' && (
          <div className="p-4 sm:p-5 space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Catalog Sync (T2)</h4>
                  <p className="text-[11px] text-slate-400">Resets High Water Marks to 0 to pull full product master & prices</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                If prices or items on this till fall out of sync with the Local Hub or other tills, trigger a full catalog re-sync.
              </p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await meshSyncService.resetCatalogHwmToZero();
                    setSaveSuccessNotice('Force Catalog Sync initiated! All T2 catalog data requested from Hub.');
                    setTimeout(() => setSaveSuccessNotice(null), 4000);
                  } catch (err: any) {
                    alert('Error resetting catalog sync: ' + err.message);
                  }
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Force Catalog Sync (Reset T2 to 0)</span>
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Transaction Sync (T1)</h4>
                  <p className="text-[11px] text-slate-400">Re-fetches sales, cash logs & GRVs from chosen date</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Select a start date to pull historical transactions from the Local Hub without losing local entries:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  id="sync-mgr-target-date"
                  defaultValue={new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const input = document.getElementById('sync-mgr-target-date') as HTMLInputElement;
                    const dateVal = input ? input.value : '';
                    try {
                      await meshSyncService.resetTransactionHwm(dateVal);
                      setSaveSuccessNotice(`Force Transaction Sync initiated from ${dateVal || 'the beginning'}!`);
                      setTimeout(() => setSaveSuccessNotice(null), 4000);
                    } catch (err: any) {
                      alert('Error resetting transaction sync: ' + err.message);
                    }
                  }}
                  className="py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Sync Transactions</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between p-4 sm:p-5 bg-slate-900/95 backdrop-blur-md border-t border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadScript}
              className="text-xs font-bold px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>termux-hub.js</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition active:scale-95 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>

      {/* Reset Hub Identity Confirmation Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/30 rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Reset Hub Identity?</h3>
                <p className="text-xs text-rose-300 font-medium mt-1 leading-relaxed">
                  This will wipe the Local Hub's memory and allow it to be reassigned to a new branch. Only do this if you are moving the Hub hardware.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/20 text-xs text-slate-300 space-y-1">
              <p className="font-bold text-rose-300">Action Details:</p>
              <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-1">
                <li>Sends a <code>RESET_BRANCH</code> packet to the connected Termux Hub</li>
                <li>Wipes in-memory and disk records on the Hub hardware</li>
                <li>Clears local <code>hub_branch_id</code> and returns to Scan to Connect state</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isResettingHub}
                onClick={() => setShowResetConfirmModal(false)}
                className="text-xs font-bold px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResettingHub}
                onClick={handleConfirmResetHub}
                className="text-xs font-bold px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-md transition flex items-center gap-1.5 active:scale-95 cursor-pointer"
              >
                {isResettingHub ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Yes, Wipe &amp; Reset Hub</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

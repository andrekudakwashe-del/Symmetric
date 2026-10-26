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
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { LocalHubConfig, normalizeHubUrl, LocalHubTestResult } from '../../utils/localHubConfig';
import { meshSyncService, MeshConnectionMode } from '../../services/meshSyncService';
import { OfflineQRCode } from '../common/OfflineQRCode';

interface LocalHubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LocalHubSettingsModal: React.FC<LocalHubSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [hubUrlInput, setHubUrlInput] = useState<string>(() => LocalHubConfig.getLocalHubUrl());
  const [forceLocalHub, setForceLocalHub] = useState<boolean>(() => LocalHubConfig.getForceLocalHub());
  const [activeTab, setActiveTab] = useState<'connect' | 'host'>('connect');

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

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    setHubUrlInput(LocalHubConfig.getLocalHubUrl());
    setForceLocalHub(LocalHubConfig.getForceLocalHub());
    setConnStatus(meshSyncService.getConnectionStatus());
    setConnMode(meshSyncService.getConnectionMode());

    const unsubMode = meshSyncService.subscribeConnectionMode((mode, details) => {
      setConnMode(mode);
      setConnStatus(meshSyncService.getConnectionStatus());
    });

    const unsubConfig = LocalHubConfig.subscribe(() => {
      setHubUrlInput(LocalHubConfig.getLocalHubUrl());
      setForceLocalHub(LocalHubConfig.getForceLocalHub());
    });

    return () => {
      unsubMode();
      unsubConfig();
      stopCamera();
    };
  }, [isOpen]);

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
                  </span>
                  {forceLocalHub && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold">
                      FORCED LOCAL
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                  {connMode === 'LOCAL_HUB'
                    ? `Master Node: ${connStatus.localHubUrl}`
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

        {/* Tab Toggle: Connect (Client) vs Host (QR Display) */}
        <div className="px-4 sm:px-5 pt-4">
          <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs font-bold">
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
              <span>Connect to Hub</span>
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
              <span>Host QR Code</span>
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
                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 shrink-0 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 text-left text-xs text-slate-400 space-y-2 max-w-md mx-auto">
              <div className="flex items-center justify-between">
                <p className="font-bold text-slate-200">Termux Android Host Setup:</p>
                <a
                  href="/termux-hub.js"
                  download="termux-hub.js"
                  className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 underline"
                >
                  Download termux-hub.js
                </a>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Run this high-reliability hub script on the host phone. Includes <strong>SYNC_RECEIPT (ACK)</strong>, <strong>Catch-Up Sync</strong>, and <strong>Anti-Echo</strong> safeguards:
              </p>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                <code className="font-mono text-[11px] text-indigo-300 select-all">
                  node termux-hub.js --port 8080
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('node termux-hub.js --port 8080')}
                  className="text-[10px] font-bold px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Copy
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Turn on Android Portable Hotspot. Termux will bind to <code>192.168.43.1:8080</code>.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-end p-4 sm:p-5 bg-slate-900/95 backdrop-blur-md border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition active:scale-95 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

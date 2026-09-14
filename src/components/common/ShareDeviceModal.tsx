import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Smartphone,
  Tablet,
  ExternalLink,
  ShieldCheck,
  Wifi,
  WifiOff,
  QrCode,
  Share2,
  Activity,
  CheckCircle2,
  Radio,
  Server,
  Zap,
  Edit2,
  RefreshCw,
} from 'lucide-react';
import { meshSyncService } from '../../services/meshSyncService';
import { P2PMeshPeer } from '../../types';
import { OfflineQRCode } from './OfflineQRCode';

interface ShareDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAirgapModal?: () => void;
}

export const ShareDeviceModal: React.FC<ShareDeviceModalProps> = ({
  isOpen,
  onClose,
  onOpenAirgapModal,
}) => {
  const [copied, setCopied] = useState(false);
  const [branchCode, setBranchCode] = useState('HARARE-01');
  const [pingSent, setPingSent] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [otherPeers, setOtherPeers] = useState<P2PMeshPeer[]>([]);

  // Connection mode tab: 'local_wifi' (default for 0% internet) or 'cloud_relay' (when internet available)
  const [activeTab, setActiveTab] = useState<'local_wifi' | 'cloud_relay'>('local_wifi');

  // Local Wi-Fi configuration
  const [discoveredIps, setDiscoveredIps] = useState<{ name: string; ip: string; isHotspot: boolean }[]>([]);
  const [selectedLanIp, setSelectedLanIp] = useState<string>('');
  const [isEditingIp, setIsEditingIp] = useState<boolean>(false);
  const [customIpInput, setCustomIpInput] = useState<string>('');

  // Cloud shared base
  const publicSharedBase = 'https://ais-pre-xnmwjokljamyp3uo6axish-553136009202.europe-west1.run.app';

  useEffect(() => {
    if (!isOpen) return;
    const cfg = meshSyncService.getConfig();
    setBranchCode(cfg.branchCode);

    // Initial peer subscription
    const unsub = meshSyncService.subscribePeers((count, peers) => {
      const others = peers.filter((p) => !p.isThisDevice);
      setOtherPeers(others);
      setPeerCount(others.length);
    });

    // Default IP: window hostname or common router/hotspot gateway
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '192.168.1.10';
    const isCloudHost = currentHost.includes('.run.app') || currentHost === 'localhost';
    
    // Fetch local LAN IPs reported by local server
    fetch('/api/mesh/lan-info')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.lanIps) && data.lanIps.length > 0) {
          setDiscoveredIps(data.lanIps);
          // Prefer hotspot IP (192.168.43.x) or first LAN IPv4
          const hotspot = data.lanIps.find((item: any) => item.isHotspot);
          const initialIp = hotspot ? hotspot.ip : data.lanIps[0].ip;
          setSelectedLanIp(initialIp);
          setCustomIpInput(initialIp);
        } else if (!isCloudHost) {
          setSelectedLanIp(currentHost);
          setCustomIpInput(currentHost);
        } else {
          // Default fallback local Wi-Fi subnet IP
          setSelectedLanIp('192.168.1.100');
          setCustomIpInput('192.168.1.100');
        }
      })
      .catch(() => {
        if (!isCloudHost) {
          setSelectedLanIp(currentHost);
          setCustomIpInput(currentHost);
        } else {
          setSelectedLanIp('192.168.1.100');
          setCustomIpInput('192.168.1.100');
        }
      });

    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  // Local Wi-Fi URL (No internet required, same router or phone hotspot)
  const effectiveLanIp = (selectedLanIp || '192.168.1.100').trim();
  const localWifiUrl = `http://${effectiveLanIp}:3000/?branch=${encodeURIComponent(branchCode)}`;

  // Public Cloud URL (Requires active internet connection)
  const publicSharedUrl = `${publicSharedBase}?branch=${encodeURIComponent(branchCode)}`;

  const currentUrlToCopy = activeTab === 'local_wifi' ? localWifiUrl : publicSharedUrl;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentUrlToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSendPing = async () => {
    setPingSent(true);
    await meshSyncService.sendTestPing();
    setTimeout(() => setPingSent(false), 2000);
  };

  const handleSaveCustomIp = () => {
    if (customIpInput.trim()) {
      setSelectedLanIp(customIpInput.trim());
      setIsEditingIp(false);
    }
  };

  return (
    <div
      id="share-device-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
    >
      <div
        id="share-device-modal-card"
        className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-white max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Share2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>Connect Second Terminal</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border ${
                    peerCount > 0
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  }`}
                >
                  {peerCount > 0 ? `${peerCount + 1} Terminals Synced` : 'Ready to Pair'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Works offline on local Wi-Fi router or Android hotspot (0% internet required)
              </p>
            </div>
          </div>
          <button
            id="share-modal-close-button"
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Peer Status Banner */}
        {peerCount > 0 ? (
          <div
            id="peer-connected-banner"
            className="bg-emerald-950/60 border border-emerald-500/40 rounded-2xl p-3.5 flex items-center justify-between"
          >
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-emerald-200">
                  Second Terminal Connected &amp; Synced!
                </div>
                <div className="text-[11px] text-emerald-300/80 font-mono">
                  {otherPeers.map((p) => p.name).join(', ')} • Branch {branchCode}
                </div>
              </div>
            </div>
            <button
              id="ring-terminal-button"
              type="button"
              onClick={handleSendPing}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center space-x-1 shadow transition cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{pingSent ? 'Ringing!' : 'Ring Terminal'}</span>
            </button>
          </div>
        ) : (
          <div
            id="peer-waiting-banner"
            className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between"
          >
            <div className="flex items-center space-x-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
              <div>
                <div className="text-xs font-bold text-slate-200">
                  Waiting for Terminal 2 to scan QR code...
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Branch Code: <strong className="text-white">{branchCode}</strong>
                </div>
              </div>
            </div>
            <button
              id="send-test-ping-button"
              type="button"
              onClick={handleSendPing}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1 border border-slate-700 transition cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>{pingSent ? 'Ping Broadcasted' : 'Send Test Ping'}</span>
            </button>
          </div>
        )}

        {/* Network Mode Tabs */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
          <button
            id="tab-local-wifi-mode"
            type="button"
            onClick={() => setActiveTab('local_wifi')}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer ${
              activeTab === 'local_wifi'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wifi className="w-4 h-4" />
            <span>Same Wi-Fi (0% Internet)</span>
          </button>
          <button
            id="tab-cloud-relay-mode"
            type="button"
            onClick={() => setActiveTab('cloud_relay')}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer ${
              activeTab === 'cloud_relay'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Online Cloud Relay</span>
          </button>
        </div>

        {/* TAB 1: SAME WI-FI / OFFLINE LOCAL LAN */}
        {activeTab === 'local_wifi' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Explanatory badge */}
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-3 flex items-start space-x-3 text-xs text-emerald-200">
              <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-bold">100% Offline Wi-Fi Connectivity:</strong>
                Both devices must be connected to the <strong>same Wi-Fi router</strong> or <strong>Android phone hotspot</strong>. No active internet package or mobile data required!
              </div>
            </div>

            {/* Local Host IP Selection / Configuration */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Terminal 1 Local LAN IP:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditingIp(!isEditingIp)}
                  className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>{isEditingIp ? 'Cancel' : 'Change IP'}</span>
                </button>
              </div>

              {isEditingIp ? (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={customIpInput}
                    onChange={(e) => setCustomIpInput(e.target.value)}
                    placeholder="e.g. 192.168.1.15 or 192.168.43.1"
                    className="flex-1 bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomIp}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs font-mono bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                  <span className="text-emerald-400 font-bold">{effectiveLanIp}:3000</span>
                  <span className="text-[11px] text-slate-400 font-sans">Port 3000</span>
                </div>
              )}

              {/* Quick IP suggestions from network scan */}
              {discoveredIps.length > 0 && !isEditingIp && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-500">Detected:</span>
                  {discoveredIps.map((iface) => (
                    <button
                      key={iface.ip}
                      type="button"
                      onClick={() => {
                        setSelectedLanIp(iface.ip);
                        setCustomIpInput(iface.ip);
                      }}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition cursor-pointer ${
                        selectedLanIp === iface.ip
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {iface.ip} {iface.isHotspot ? '(Hotspot)' : `(${iface.name})`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* QR Code Card */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4 justify-between">
              <div className="flex flex-col items-center sm:items-start text-center sm:text-left space-y-2">
                <div className="flex items-center space-x-2 text-emerald-300 font-bold text-sm">
                  <QrCode className="w-4 h-4" />
                  <span>Scan with Phone or Tablet Camera</span>
                </div>
                <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                  Open your camera, point it at this QR code, and tap to open. Terminal 2 connects directly over your local Wi-Fi.
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <span className="flex items-center text-[11px] font-mono text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700">
                    <Tablet className="w-3.5 h-3.5 mr-1 text-indigo-400" /> Tablet
                  </span>
                  <span className="flex items-center text-[11px] font-mono text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700">
                    <Smartphone className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Android / iOS
                  </span>
                </div>
              </div>

              <div className="shrink-0">
                <OfflineQRCode
                  id="offline-lan-qr-code"
                  value={localWifiUrl}
                  size={175}
                  darkColor="#0f172a"
                  lightColor="#ffffff"
                  alt="Direct Local Wi-Fi Pairing QR Code"
                />
              </div>
            </div>

            {/* Copy Local Link */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                Local Wi-Fi Pairing Link:
              </label>
              <div className="flex items-center space-x-2">
                <input
                  id="local-wifi-link-input"
                  type="text"
                  readOnly
                  value={localWifiUrl}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none select-all"
                />
                <button
                  id="copy-local-wifi-link-button"
                  type="button"
                  onClick={handleCopy}
                  className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-1.5 shadow-md transition active:scale-95 shrink-0 cursor-pointer ${
                    copied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ONLINE CLOUD RELAY */}
        {activeTab === 'cloud_relay' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-3 flex items-start space-x-3 text-xs text-indigo-200">
              <Server className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-bold">Cloud Sync Relay Mode:</strong>
                Use this link when both devices have active internet access across different locations, mobile data networks, or separate Wi-Fi connections.
              </div>
            </div>

            {/* QR Code Card */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4 justify-between">
              <div className="flex flex-col items-center sm:items-start text-center sm:text-left space-y-2">
                <div className="flex items-center space-x-2 text-indigo-300 font-bold text-sm">
                  <QrCode className="w-4 h-4" />
                  <span>Public Cloud Shared Link</span>
                </div>
                <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                  Terminal 2 will open the public hosted app with branch <strong>{branchCode}</strong> automatically paired.
                </p>
              </div>

              <div className="shrink-0">
                <OfflineQRCode
                  id="cloud-relay-qr-code"
                  value={publicSharedUrl}
                  size={175}
                  darkColor="#1e1b4b"
                  lightColor="#ffffff"
                  alt="Cloud Relay QR Code"
                />
              </div>
            </div>

            {/* Copy Cloud Link */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                Public Direct URL:
              </label>
              <div className="flex items-center space-x-2">
                <input
                  id="cloud-link-input"
                  type="text"
                  readOnly
                  value={publicSharedUrl}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-indigo-300 focus:outline-none select-all"
                />
                <button
                  id="copy-cloud-link-button"
                  type="button"
                  onClick={handleCopy}
                  className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-1.5 shadow-md transition active:scale-95 shrink-0 cursor-pointer ${
                    copied
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-700 hover:bg-indigo-600 text-white'
                  }`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
                <a
                  href={publicSharedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                  title="Open in new window"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Airgap Optical Scanner Shortcut */}
        {onOpenAirgapModal && (
          <div className="bg-slate-950/70 border border-purple-500/30 rounded-2xl p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Radio className="w-4 h-4 text-purple-400" />
              <div>
                <span className="text-xs font-bold text-white block">
                  Camera-to-Screen Airgap &amp; WebRTC
                </span>
                <span className="text-[11px] text-slate-400">
                  Transmit sales directly screen-to-camera with zero router or network
                </span>
              </div>
            </div>
            <button
              id="switch-to-airgap-modal-button"
              type="button"
              onClick={() => {
                onClose();
                onOpenAirgapModal();
              }}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow cursor-pointer transition shrink-0"
            >
              Optical Scan
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-800">
          <div className="flex items-center space-x-2 text-[11px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Branch {branchCode} Cluster Ready</span>
          </div>
          <button
            id="share-modal-done-button"
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

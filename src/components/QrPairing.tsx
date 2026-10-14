import React, { useState, useEffect, useRef } from 'react';
import {
  QrCode,
  Camera,
  Wifi,
  WifiOff,
  Radio,
  Server,
  Smartphone,
  Copy,
  Check,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  ShoppingCart,
  Layers,
  X,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { localSyncService, TillMeshRole, LocalSyncStats, LocalPeerInfo } from '../services/localSyncService';
import { syncService } from '../services/syncService';
import { OfflineQRCode } from './common/OfflineQRCode';
import { addSale, getCurrentCompanyId, getCurrentBranchId } from '../db/roomDatabase';
import { SaleInvoice } from '../types';

interface QrPairingProps {
  onClose?: () => void;
  className?: string;
}

export const QrPairing: React.FC<QrPairingProps> = ({ onClose, className = '' }) => {
  const [role, setRole] = useState<TillMeshRole>(() => localSyncService.getRole());
  const [hostIpInput, setHostIpInput] = useState<string>(() => localSyncService.getHostIp());
  const [stats, setStats] = useState<LocalSyncStats>(() => localSyncService.getStats());
  const [peers, setPeers] = useState<LocalPeerInfo[]>(() => localSyncService.getConnectedPeers());
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [recentSales, setRecentSales] = useState<Array<{ id: string; amount: number; itemsCount: number; from: string; time: string }>>([]);
  const [testSaleNotice, setTestSaleNotice] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const scannerRegionId = 'qr-pairing-reader';
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const unsubStats = localSyncService.subscribeStats((newStats) => {
      setStats(newStats);
      setPeers(localSyncService.getConnectedPeers());
      if (newStats.role !== role) {
        setRole(newStats.role);
      }
    });

    const unsubSale = localSyncService.onSaleReceived((sale, peerName) => {
      const itemsCount = sale.items?.length || 0;
      setRecentSales((prev) => [
        {
          id: sale.invoiceNumber || sale.id,
          amount: sale.totalAmount || 0,
          itemsCount,
          from: peerName,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 9),
      ]);
    });

    return () => {
      unsubStats();
      unsubSale();
      stopCamera();
    };
  }, []);

  const handleRoleChange = (newRole: TillMeshRole) => {
    setRole(newRole);
    localSyncService.setRole(newRole);
    if (isScanning) {
      stopCamera();
    }
  };

  const handleApplyHostIp = (ip: string) => {
    setHostIpInput(ip);
    localSyncService.setHostIp(ip);
  };

  const handleCopy = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedUrl(label);
      setTimeout(() => setCopiedUrl(null), 2000);
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    setIsScanning(true);
    try {
      if (html5QrCodeRef.current) {
        try {
          await html5QrCodeRef.current.stop();
        } catch (_) {}
      }

      const qr = new Html5Qrcode(scannerRegionId, { verbose: false });
      html5QrCodeRef.current = qr;

      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          stopCamera();
          const res = await localSyncService.handleScannedQrData(decodedText);
          if (res.success) {
            setTestSaleNotice(res.message);
            setTimeout(() => setTestSaleNotice(null), 4000);
          } else {
            setCameraError(res.message);
          }
        },
        () => {}
      );
    } catch (err: any) {
      setIsScanning(false);
      setCameraError('Camera access unavailable. Please type Host IP manually below.');
    }
  };

  const stopCamera = async () => {
    setIsScanning(false);
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (_) {}
      html5QrCodeRef.current = null;
    }
  };

  // Test Case: Client adds sale with 20 items and verifies Host sees it instantly
  const handleSendTestSale20Items = async () => {
    try {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `TEST-ITEM-${i + 1}`,
        productId: `PROD-${i + 1}`,
        productName: `Mesh Test Item #${i + 1}`,
        name: `Mesh Test Item #${i + 1}`,
        quantity: 1,
        unitPrice: 1.5,
        price: 1.5,
        total: 1.5,
        unit: 'unit',
      }));

      const newSale: SaleInvoice = {
        id: `SALE-MESH-${Date.now()}`,
        invoiceNumber: `INV-P2P-${Math.floor(1000 + Math.random() * 9000)}`,
        company_id: getCurrentCompanyId(),
        branch_id: getCurrentBranchId(),
        branchCode: 'HARARE-01',
        timestamp: new Date().toISOString(),
        customer: { id: 'CUST-MESH-01', name: 'Hotspot Test Customer' },
        items: items as any,
        subtotal: 30.0,
        discount: 0,
        tax: 0,
        totalAmount: 30.0,
        paymentMethod: 'Cash',
        currency: 'USD',
        cashierId: 'TILL-P2P',
        cashierName: 'Offline Mesh Cashier',
        status: 'Completed',
        syncStatus: 'pending',
      };

      // Add to roomDatabase
      addSale(newSale);

      // Dispatch via local mesh directly to Host Till
      await syncService.dispatchSale(newSale);

      setTestSaleNotice(`Created & Pushed 20-item sale (${newSale.invoiceNumber}) directly to Host Till via offline mesh!`);
      setTimeout(() => setTestSaleNotice(null), 5000);
    } catch (err: any) {
      setTestSaleNotice(`Error: ${err.message || 'Could not send test sale'}`);
    }
  };

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const hostWsUrl = stats.role === 'HOST' ? localSyncService.getHostWsUrl() : `${isHttps ? 'wss://' : 'ws://'}${hostIpInput}:3000`;
  const hostHttpUrl = stats.role === 'HOST' ? localSyncService.getHostHttpUrl() : `${isHttps ? 'https://' : 'http://'}${hostIpInput}:3000`;

  return (
    <div className={`bg-slate-900 border border-emerald-500/30 rounded-3xl p-5 md:p-6 text-white shadow-2xl space-y-6 ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black tracking-wide text-white">SHAREit / Xender P2P Mesh</h2>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                0% Internet Required
              </span>
              {isHttps && (
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>HTTPS Secure</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">Zero data bundles • Direct Wi-Fi hotspot & local WebRTC / WebSocket mesh</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Mode Switch: HOST TILL vs CLIENT TILL */}
      <div className="bg-slate-950 p-1.5 rounded-2xl border border-slate-800 flex items-center gap-1">
        <button
          onClick={() => handleRoleChange('HOST')}
          className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
            role === 'HOST'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>HOST TILL (Main Phone / Hotspot)</span>
        </button>
        <button
          onClick={() => handleRoleChange('CLIENT')}
          className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
            role === 'CLIENT'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          <span>CLIENT TILL (Secondary Cashier)</span>
        </button>
      </div>

      {/* HOST TILL VIEW */}
      {role === 'HOST' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* QR Code Presentation */}
            <div className="bg-slate-950/80 border border-emerald-500/30 rounded-2xl p-5 flex flex-col items-center text-center space-y-4">
              <div className="bg-white p-3 rounded-2xl shadow-xl">
                <OfflineQRCode
                  value={hostWsUrl}
                  size={200}
                  errorCorrectionLevel="M"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 inline-block">
                  {hostWsUrl}
                </span>
                <p className="text-[11px] text-slate-400">Scan this QR on Client Till to pair instantly</p>
              </div>
            </div>

            {/* Hotspot Instructions & Connection Details */}
            <div className="space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Host IP:</span>
                    <span className="font-mono font-bold text-emerald-400">{stats.localIp}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">WebSocket Protocol:</span>
                    <span className="font-mono text-slate-300">{isHttps ? 'Secure WSS (wss://)' : '3000 (ws://)'}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">PWA Web URL:</span>
                    <span className="font-mono text-slate-300">{hostHttpUrl}</span>
                  </div>
                </div>

                <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-2xl p-4 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-300">
                    <Wifi className="w-4 h-4 text-emerald-400" />
                    <span>How other phones connect (ZERO DATA BUNDLES):</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300">
                    <li>Turn on <b>Personal Hotspot</b> on this phone (no bundles needed).</li>
                    <li>Connect client phones to this phone's Wi-Fi.</li>
                    <li>Open <b>{hostHttpUrl}</b> in client browser or scan QR.</li>
                  </ol>
                </div>

                {/* SSL Security Context Note */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>SSL &amp; Browser Security:</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Connecting via <strong>{isHttps ? 'HTTPS (Active)' : 'HTTPS'}</strong> gives you the secure green padlock. If opened via raw local IP (<code>http://192.168.x.x</code>), Chrome displays a red hexagon/badge because private LAN subnets lack SSL certificates.
                  </p>
                </div>
              </div>

              {/* Copy Links */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(hostWsUrl, 'ws')}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center gap-2 transition"
                >
                  {copiedUrl === 'ws' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedUrl === 'ws' ? (isHttps ? 'Copied WSS Link' : 'Copied WS Link') : (isHttps ? 'Copy wss:// Link' : 'Copy ws:// Link')}</span>
                </button>
                <button
                  onClick={() => handleCopy(hostHttpUrl, 'http')}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center gap-2 transition"
                >
                  {copiedUrl === 'http' ? <Check className="w-4 h-4 text-emerald-400" /> : <ExternalLink className="w-4 h-4" />}
                  <span>{copiedUrl === 'http' ? (isHttps ? 'Copied HTTPS Link' : 'Copied HTTP Link') : (isHttps ? 'Copy https:// Link' : 'Copy http:// Link')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Connected Peers Summary */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200">Connected Client Tills</span>
                <span className="text-[11px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  {peers.length} Online
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Total Mesh Sales: {stats.totalSyncedSalesCount}</span>
            </div>

            {peers.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2 text-center">
                Waiting for client tills to connect via Wi-Fi hotspot...
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {peers.map((peer) => (
                  <div key={peer.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      <span className="font-bold text-slate-200">{peer.name}</span>
                    </div>
                    <span className="font-mono text-slate-400 text-[11px]">{peer.connectedVia}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CLIENT TILL VIEW */}
      {role === 'CLIENT' && (
        <div className="space-y-6">
          {/* Status Badge */}
          <div className={`p-4 rounded-2xl border flex items-center justify-between ${
            stats.isConnectedToHost
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${stats.isConnectedToHost ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <div>
                <span className="text-xs font-bold uppercase tracking-wider block">
                  {stats.isConnectedToHost ? 'CONNECTED TO HOST TILL (0% DATA USED)' : 'SEARCHING FOR HOST TILL...'}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Target Host: {isHttps ? 'wss://' : 'ws://'}{hostIpInput}:3000
                </span>
              </div>
            </div>
            <button
              onClick={() => localSyncService.reconnect()}
              className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white flex items-center gap-1.5 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>

          {/* Camera Scanner View */}
          {isScanning && (
            <div className="bg-slate-950 rounded-2xl p-4 border border-cyan-500/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300">Point Camera at Host QR Code</span>
                <button onClick={stopCamera} className="text-xs text-slate-400 hover:text-white">Cancel</button>
              </div>
              <div id={scannerRegionId} className="w-full max-w-sm mx-auto rounded-xl overflow-hidden bg-black aspect-square" />
            </div>
          )}

          {cameraError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Connect Inputs */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={hostIpInput}
                  onChange={(e) => setHostIpInput(e.target.value)}
                  placeholder="Enter Host IP (e.g. 192.168.43.1)"
                  className="w-full py-3 px-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                onClick={() => handleApplyHostIp(hostIpInput)}
                className="py-3 px-5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white flex items-center justify-center gap-2 transition"
              >
                <span>Connect IP</span>
              </button>
              <button
                onClick={isScanning ? stopCamera : startCamera}
                className="py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs text-cyan-300 border border-cyan-500/30 flex items-center justify-center gap-2 transition"
              >
                <Camera className="w-4 h-4" />
                <span>{isScanning ? 'Close Scanner' : 'Scan Host QR'}</span>
              </button>
            </div>

            {/* Quick Hotspot Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Common Hotspot Presets:</span>
              <div className="flex flex-wrap gap-2">
                {localSyncService.getCommonIps().map((ip) => (
                  <button
                    key={ip}
                    onClick={() => handleApplyHostIp(ip)}
                    className={`py-1.5 px-3 rounded-lg text-xs font-mono border transition ${
                      hostIpInput === ip
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {ip} {ip === '192.168.43.1' ? '(Android Hotspot)' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Test Case #5 Button: 20 Items Sale */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/40 to-slate-950 border border-cyan-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">Test Case #5: 20-Item Offline Sale</span>
                <span className="text-[11px] text-slate-400">Pushes instantly to Host Till with 0% internet used</span>
              </div>
              <button
                onClick={handleSendTestSale20Items}
                className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:opacity-90 font-black text-xs text-white shadow-lg flex items-center gap-2 transition"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Dispatch 20-Item Sale</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Notice Toast */}
      {testSaleNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-900/60 border border-emerald-500/60 text-emerald-200 text-xs font-medium flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{testSaleNotice}</span>
        </div>
      )}

      {/* Live Sales Stream Notification for Host */}
      {recentSales.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">Live Incoming Mesh Sales</span>
            <span className="text-[11px] text-emerald-400 font-mono">Instant P2P Sync</span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {recentSales.map((s) => (
              <div key={s.id} className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-mono font-bold text-white">{s.id}</span>
                  <span className="text-slate-400">({s.itemsCount} items)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-400">${s.amount.toFixed(2)}</span>
                  <span className="text-[10px] text-slate-500">{s.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default QrPairing;

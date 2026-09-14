import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  QrCode,
  Camera,
  CheckCircle2,
  Copy,
  Check,
  Smartphone,
  Wifi,
  WifiOff,
  Radio,
  ArrowRight,
  RefreshCw,
  Layers,
  AlertCircle,
  Zap,
  Flashlight,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { meshSyncService } from '../../services/meshSyncService';
import { getSales } from '../../db/roomDatabase';
import { OfflineQRCode } from '../common/OfflineQRCode';

interface OfflineAirgapSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchCode: string;
}

export const OfflineAirgapSyncModal: React.FC<OfflineAirgapSyncModalProps> = ({
  isOpen,
  onClose,
  branchCode,
}) => {
  const [activeTab, setActiveTab] = useState<'transmit' | 'receive' | 'webrtc'>('transmit');
  const [copied, setCopied] = useState(false);
  const [scannedResult, setScannedResult] = useState<{
    success: boolean;
    count: number;
    message: string;
    details?: string;
  } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [qrDetected, setQrDetected] = useState(false);

  // WebRTC Offline LAN state
  const [webrtcStep, setWebrtcStep] = useState<'create_offer' | 'scan_offer' | 'scan_answer' | 'connected'>('create_offer');
  const [webrtcOfferStr, setWebrtcOfferStr] = useState<string>('');
  const [webrtcAnswerStr, setWebrtcAnswerStr] = useState<string>('');

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const qrRegionId = 'offline-qr-reader';

  // Toggle Torch for low-light / dark shops
  const toggleTorch = async () => {
    const nextState = !isTorchOn;
    try {
      if (html5QrCodeRef.current) {
        await html5QrCodeRef.current.applyVideoConstraints({
          advanced: [{ torch: nextState }],
        });
        setIsTorchOn(nextState);
        return;
      }
    } catch (e) {}

    try {
      const videoEl = document.querySelector(`#${qrRegionId} video`) as HTMLVideoElement | null;
      if (videoEl && videoEl.srcObject) {
        const stream = videoEl.srcObject as MediaStream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          await track.applyConstraints({
            advanced: [{ torch: nextState } as any],
          });
          setIsTorchOn(nextState);
          return;
        }
      }
    } catch (e) {}

    const res = await meshSyncService.toggleTorch(nextState);
    setIsTorchOn(res);
  };

  // Current offline batch payload from this device
  const [batchPayload, setBatchPayload] = useState<string>('');
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    // Generate batch of sales to transmit
    const payload = meshSyncService.generateOfflineBatchPayload();
    setBatchPayload(payload);
    try {
      const parsed = JSON.parse(payload);
      setPendingCount(parsed.sales?.length || 0);
    } catch (e) {
      setPendingCount(0);
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    // When tab changes to receive, auto-start camera if not already scanning
    if (isOpen && activeTab === 'receive') {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  const startCamera = async () => {
    setCameraError(null);
    setScannedResult(null);

    // Wait for DOM element
    await new Promise((r) => setTimeout(r, 200));

    try {
      if (html5QrCodeRef.current) {
        try {
          await html5QrCodeRef.current.stop();
        } catch (e) {}
      }

      const qr = new Html5Qrcode(qrRegionId);
      html5QrCodeRef.current = qr;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      };

      await qr.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          setQrDetected(true);
          meshSyncService.onScanSuccess(decodedText);
          handleDecodedPayload(decodedText);
        },
        () => {
          // ignore scan frame misses
        }
      );
      setIsScanning(true);

      // Link video track for torch
      try {
        const videoEl = document.querySelector(`#${qrRegionId} video`) as HTMLVideoElement | null;
        if (videoEl && videoEl.srcObject) {
          const stream = videoEl.srcObject as MediaStream;
          meshSyncService.setActiveVideoTrack(stream.getVideoTracks()[0] || null);
        }
      } catch (e) {}
    } catch (err: any) {
      console.warn('Camera start error:', err);
      setIsScanning(false);
      setCameraError(
        'Unable to access camera directly. Ensure camera permissions are allowed, or paste the Offline Sync Token below.'
      );
    }
  };

  const stopCamera = async () => {
    setIsTorchOn(false);
    setQrDetected(false);
    meshSyncService.setActiveVideoTrack(null);
    if (html5QrCodeRef.current && isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (e) {}
    }
    setIsScanning(false);
  };

  const handleDecodedPayload = (rawString: string) => {
    try {
      // Check if WebRTC handshake packet
      if (rawString.startsWith('SAIMETRIC_WEBRTC_OFFER:')) {
        const offer = rawString.replace('SAIMETRIC_WEBRTC_OFFER:', '');
        meshSyncService.acceptWebRtcOffer(offer).then((answer) => {
          setWebrtcAnswerStr(answer);
          setActiveTab('webrtc');
          setWebrtcStep('scan_answer');
        });
        return;
      }

      if (rawString.startsWith('SAIMETRIC_WEBRTC_ANSWER:')) {
        const answer = rawString.replace('SAIMETRIC_WEBRTC_ANSWER:', '');
        meshSyncService.completeWebRtcAnswer(answer);
        setActiveTab('webrtc');
        setWebrtcStep('connected');
        return;
      }

      // Normal Offline Sales Batch Ingestion
      const res = meshSyncService.ingestOfflineBatchPayload(rawString);
      setScannedResult({
        success: res.success,
        count: res.syncedCount,
        message: res.message,
        details: res.details,
      });

      if (res.success) {
        stopCamera();
      }
    } catch (err: any) {
      setScannedResult({
        success: false,
        count: 0,
        message: 'Invalid offline sync packet or corrupted QR code.',
      });
    }
  };

  const handleManualSubmit = () => {
    if (!manualToken.trim()) return;
    handleDecodedPayload(manualToken.trim());
    setManualToken('');
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(batchPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleGenerateWebRtcOffer = async () => {
    const offer = await meshSyncService.startWebRtcOffer();
    setWebrtcOfferStr(offer);
    setWebrtcStep('create_offer');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-white max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <WifiOff className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>Offline Local Mesh Sync</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/30">
                  Zero-Internet Ready
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Sync sales between terminals without internet, cables, or cellular data
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setActiveTab('transmit');
              setScannedResult(null);
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
              activeTab === 'transmit'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Transmit Sales</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('receive');
              setScannedResult(null);
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
              activeTab === 'receive'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Receive (Scan)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('webrtc');
              setScannedResult(null);
              if (!webrtcOfferStr) handleGenerateWebRtcOffer();
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
              activeTab === 'webrtc'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Direct LAN Wi-Fi</span>
          </button>
        </div>

        {/* TAB 1: TRANSMIT SALES (SHOW QR) */}
        {activeTab === 'transmit' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-2 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start space-x-2 text-emerald-400 font-bold text-sm">
                  <Zap className="w-4 h-4" />
                  <span>Offline Sales Optical Beacon</span>
                </div>
                <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                  Hold this QR code up to your second terminal or phone camera. Terminal 2 will instantly ingest all transactions and update inventory.
                </p>
                <div className="pt-2 flex items-center justify-center sm:justify-start gap-2">
                  <span className="text-xs font-mono font-bold bg-slate-900 px-3 py-1 rounded-lg border border-slate-700 text-slate-200">
                    {pendingCount} Sale{pendingCount === 1 ? '' : 's'} in Beacon
                  </span>
                  <span className="text-xs font-mono font-bold bg-emerald-950/80 px-3 py-1 rounded-lg border border-emerald-500/30 text-emerald-300">
                    Branch: {branchCode}
                  </span>
                </div>
              </div>

              <div className="shrink-0">
                <OfflineQRCode
                  value={batchPayload || 'SAIMETRIC_EMPTY'}
                  size={190}
                  darkColor="#0f172a"
                  lightColor="#ffffff"
                  alt="Offline sales sync QR code"
                />
              </div>
            </div>

            {/* Copy Manual Sync Token (Fallback for cameras with glare) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                Offline Sync Token (Alternative to Camera Scan):
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={batchPayload}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none select-all truncate"
                />
                <button
                  type="button"
                  onClick={handleCopyPayload}
                  className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center space-x-1.5 shadow transition active:scale-95 shrink-0 cursor-pointer ${
                    copied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied Token!' : 'Copy Token'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RECEIVE SALES (SCAN QR CAMERA) */}
        {activeTab === 'receive' && (
          <div className="space-y-4 animate-fadeIn">
            {scannedResult ? (
              <div
                className={`p-5 rounded-2xl border text-center space-y-3 ${
                  scannedResult.success
                    ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-100'
                    : 'bg-red-950/70 border-red-500/60 text-red-100'
                }`}
              >
                <div className="flex justify-center">
                  {scannedResult.success ? (
                    <div className="p-3 bg-emerald-500/20 rounded-full text-emerald-400 border border-emerald-500/40">
                      <CheckCircle2 className="w-8 h-8 animate-bounce" />
                    </div>
                  ) : (
                    <div className="p-3 bg-red-500/20 rounded-full text-red-400 border border-red-500/40">
                      <AlertCircle className="w-8 h-8" />
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-base font-black">
                    {scannedResult.success ? 'Offline Sync Successful!' : 'Sync Failed'}
                  </h4>
                  <p className="text-xs mt-1 text-slate-300">{scannedResult.message}</p>
                  {scannedResult.details && (
                    <p className="text-[11px] font-mono mt-1 text-emerald-300 bg-black/40 p-2 rounded-lg">
                      {scannedResult.details}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScannedResult(null);
                    startCamera();
                  }}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer"
                >
                  Scan Another Terminal
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Torch button for dark shops & status */}
                <div className="flex items-center justify-between px-1">
                  <button
                    type="button"
                    id="btn-scanner-torch"
                    onClick={toggleTorch}
                    className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition border cursor-pointer ${
                      isTorchOn
                        ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.6)]'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                    title="Toggle camera flashlight for dark shops"
                  >
                    <Flashlight className={`w-4 h-4 ${isTorchOn ? 'text-slate-950 fill-slate-950' : 'text-amber-400'}`} />
                    <span>{isTorchOn ? 'Torch ON' : 'Torch (Dark Shop)'}</span>
                  </button>
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${qrDetected ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}`} />
                    {qrDetected ? 'QR Locked' : 'Aim at QR Code'}
                  </span>
                </div>

                <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-700 aspect-square max-w-sm mx-auto flex items-center justify-center">
                  <div id={qrRegionId} className="w-full h-full" />

                  {/* Red Box around detected QR */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div
                      id="detected-qr-red-box"
                      className={`w-60 h-60 border-2 rounded-2xl transition-all duration-300 relative ${
                        qrDetected
                          ? 'border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.9)] ring-4 ring-red-500/50 bg-red-500/10 scale-105'
                          : 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] ring-2 ring-red-500/20'
                      }`}
                    >
                      {/* Red corner brackets */}
                      <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-red-500 rounded-tl-lg" />
                      <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-red-500 rounded-tr-lg" />
                      <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-red-500 rounded-bl-lg" />
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-red-500 rounded-br-lg" />

                      {/* Red scanning laser line */}
                      <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse top-1/2 -translate-y-1/2 shadow-[0_0_8px_#ef4444]" />

                      {qrDetected && (
                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-red-600 text-white font-mono font-bold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                          QR Detected
                        </div>
                      )}
                    </div>
                  </div>

                  {!isScanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-950/90 space-y-2">
                      <Camera className="w-8 h-8 text-slate-500 animate-pulse" />
                      <p className="text-xs text-slate-400">Starting camera preview...</p>
                    </div>
                  )}
                </div>

                {cameraError && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200">
                    {cameraError}
                  </div>
                )}

                {/* Manual Token Paste */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-bold text-slate-400 block">
                    Or Paste Sync Token Manually:
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="Paste JSON token from Terminal 1..."
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleManualSubmit}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
                    >
                      Ingest
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DIRECT LOCAL WEBRTC WI-FI DATACHANNEL */}
        {activeTab === 'webrtc' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-purple-950/30 border border-purple-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center space-x-2 text-purple-300 font-bold text-sm">
                <Radio className="w-4 h-4 text-purple-400" />
                <span>Direct Local Wi-Fi Peer-to-Peer DataChannel</span>
              </div>
              <p className="text-xs text-purple-200/80 leading-relaxed">
                Connects two devices directly through your local Wi-Fi router or Android mobile hotspot. Once linked via this 2-second QR handshake, all sales stream directly over local Wi-Fi with <strong>0% internet required</strong>!
              </p>
            </div>

            {webrtcStep === 'create_offer' && (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4 justify-between">
                <div className="space-y-2 text-center sm:text-left">
                  <span className="text-xs font-bold text-purple-400">Step 1 on Terminal 1:</span>
                  <h4 className="text-sm font-black text-white">Show Handshake QR to Terminal 2</h4>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Terminal 2 should switch to &ldquo;Receive (Scan)&rdquo; tab and scan this QR code.
                  </p>
                </div>
                <div className="shrink-0">
                  <OfflineQRCode
                    value={webrtcOfferStr ? `SAIMETRIC_WEBRTC_OFFER:${webrtcOfferStr}` : ''}
                    size={180}
                    darkColor="#1e1b4b"
                    lightColor="#ffffff"
                    errorCorrectionLevel="L"
                    alt="WebRTC Offer QR"
                  />
                </div>
              </div>
            )}

            {webrtcStep === 'scan_answer' && (
              <div className="bg-slate-950 border border-emerald-500/40 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4 justify-between">
                <div className="space-y-2 text-center sm:text-left">
                  <span className="text-xs font-bold text-emerald-400">Step 2 on Terminal 2:</span>
                  <h4 className="text-sm font-black text-white">Terminal 1 Scans This Answer QR</h4>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Scan this back on Terminal 1 to complete the direct local Wi-Fi DataChannel handshake.
                  </p>
                </div>
                <div className="shrink-0">
                  <OfflineQRCode
                    value={webrtcAnswerStr ? `SAIMETRIC_WEBRTC_ANSWER:${webrtcAnswerStr}` : ''}
                    size={180}
                    darkColor="#047857"
                    lightColor="#ffffff"
                    errorCorrectionLevel="L"
                    alt="WebRTC Answer QR"
                  />
                </div>
              </div>
            )}

            {webrtcStep === 'connected' && (
              <div className="bg-emerald-950/60 border border-emerald-500/60 rounded-2xl p-5 text-center space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto animate-bounce" />
                <h4 className="text-base font-black text-white">Direct Local Wi-Fi Channel Connected!</h4>
                <p className="text-xs text-emerald-200">
                  Terminals are now linked directly over the local Wi-Fi network. Every sale rungs up offline will sync immediately!
                </p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-800">
          <div className="text-xs text-slate-400 flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Store-and-Forward Engine Active</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

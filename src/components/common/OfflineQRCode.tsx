import React, { useEffect, useState, useRef } from 'react';
import QRCode, { QRCodeErrorCorrectionLevel } from 'qrcode';

interface OfflineQRCodeProps {
  value: string;
  size?: number;
  className?: string;
  darkColor?: string;
  lightColor?: string;
  errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
  alt?: string;
  id?: string;
}

/**
 * 100% Client-Side Offline QR Code Component.
 * Requires ZERO internet connection or external APIs (e.g. api.qrserver.com).
 * Renders instantly offline using browser Canvas and in-memory DataURL.
 */
export const OfflineQRCode: React.FC<OfflineQRCodeProps> = ({
  value,
  size = 240,
  className = '',
  darkColor = '#0f172a',
  lightColor = '#ffffff',
  errorCorrectionLevel = 'M',
  alt = 'Offline QR Code',
  id,
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!value) {
      setDataUrl('');
      setError(null);
      return;
    }

    let isMounted = true;

    // Generate local data URL via Promise
    const qrOptions: QRCode.QRCodeToDataURLOptions = {
      width: size,
      margin: 2,
      errorCorrectionLevel: (errorCorrectionLevel || 'medium') as QRCode.QRCodeErrorCorrectionLevel,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    };

    QRCode.toDataURL(value, qrOptions)
      .then((url) => {
        if (!isMounted) return;
        setError(null);
        setDataUrl(url);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Offline QR generation error:', err);
        setError('Failed to generate QR code offline.');
        // Fallback to canvas
        if (canvasRef.current) {
          QRCode.toCanvas(
            canvasRef.current,
            value,
            {
              width: size,
              margin: 2,
              errorCorrectionLevel: 'low',
              color: { dark: darkColor, light: lightColor },
            }
          ).catch(() => {});
        }
      });

    return () => {
      isMounted = false;
    };
  }, [value, size, darkColor, lightColor, errorCorrectionLevel]);

  if (!value) {
    return (
      <div
        id={id}
        style={{ width: size, height: size }}
        className={`flex items-center justify-center bg-slate-950/60 rounded-2xl border border-dashed border-slate-700 text-xs text-slate-500 font-mono text-center p-3 ${className}`}
      >
        Waiting for payload...
      </div>
    );
  }

  if (error) {
    return (
      <div
        id={id}
        style={{ width: size, height: size }}
        className={`flex flex-col items-center justify-center bg-rose-950/40 rounded-2xl border border-rose-600/40 text-rose-300 text-xs text-center p-3 space-y-1 ${className}`}
      >
        <span>Data too large for QR</span>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  return (
    <div
      id={id}
      className={`inline-block p-2 bg-white rounded-2xl shadow-lg border-2 border-slate-200 overflow-hidden ${className}`}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={alt}
          width={size}
          height={size}
          className="block rounded-xl"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          style={{ width: size, height: size }}
          className="flex items-center justify-center bg-slate-100 rounded-xl animate-pulse text-xs text-slate-400 font-mono"
        >
          Rendering QR...
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

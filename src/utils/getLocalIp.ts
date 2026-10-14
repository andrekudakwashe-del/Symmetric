/**
 * WebRTC Local IP Discovery (100% Offline / Zero-Internet)
 * Discovers private LAN / Wi-Fi Hotspot IP addresses (e.g. 192.168.43.1, 192.168.x.x)
 * using client-side RTCPeerConnection candidate inspection with zero external STUN servers.
 */

export const COMMON_HOTSPOT_IPS = [
  '192.168.43.1',   // Android Default Hotspot
  '192.168.137.1',  // Windows / iPhone Hotspot
  '192.168.1.1',    // Standard Home/Office Router
  '192.168.0.101',  // Common Retail LAN IP
  '192.168.1.100',  // Common Retail LAN IP
];

/**
 * Extracts local IP via WebRTC ICE candidate gathering.
 * Works without internet data bundles or cloud servers.
 */
export async function getLocalIp(): Promise<string> {
  // 1. If currently hosted on a local IP in the browser address bar, prioritize it
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host)) {
      return host;
    }
  }

  // 2. Try WebRTC candidate extraction
  const webrtcPromise = new Promise<string>((resolve) => {
    try {
      if (typeof RTCPeerConnection === 'undefined') {
        resolve('');
        return;
      }

      // Zero-server RTCPeerConnection (no STUN/TURN needed for host candidates)
      const pc = new RTCPeerConnection({ iceServers: [] });
      let resolved = false;

      // Create dummy data channel to force ICE candidate gathering
      pc.createDataChannel('p2p-ip-probe');

      pc.onicecandidate = (event) => {
        if (!event || !event.candidate) return;
        const candidate = event.candidate.candidate;
        // Regex matches standard IPv4 dotted notation
        const match = candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
        if (match && match[1]) {
          const ip = match[1];
          // Exclude loopback and mDNS zeros
          if (ip !== '127.0.0.1' && !ip.startsWith('0.') && !ip.startsWith('169.254.')) {
            if (!resolved) {
              resolved = true;
              try { pc.close(); } catch (_) {}
              resolve(ip);
            }
          }
        }
      };

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {});

      // Safety timeout in case browser hides host candidates for privacy (mDNS)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { pc.close(); } catch (_) {}
          resolve('');
        }
      }, 1200);
    } catch (_) {
      resolve('');
    }
  });

  const discovered = await webrtcPromise;
  if (discovered) return discovered;

  // 3. Fallback: Query local server's LAN interfaces if reachable
  try {
    const res = await fetch('/api/mesh/lan-info', { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.lanIps) && data.lanIps.length > 0) {
        const hotspot = data.lanIps.find((item: any) => item.isHotspot);
        if (hotspot && hotspot.ip) return hotspot.ip;
        if (data.lanIps[0] && data.lanIps[0].ip) return data.lanIps[0].ip;
      }
    }
  } catch (_) {}

  // 4. Default to standard SHAREit / Xender Android Wi-Fi hotspot gateway
  return '192.168.43.1';
}

export default getLocalIp;

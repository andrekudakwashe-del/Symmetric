import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary.tsx';
import './index.css';

// Register Service Worker in production for offline PWA; unregister in development or within iframes to avoid intercepting Vite
if ('serviceWorker' in navigator) {
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;
  if (import.meta.env.DEV || isIframe) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.unregister().catch(() => {});
      }
    }).catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('SAIMETRIC Service Worker active:', reg.scope);
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          reg.onupdatefound = () => {
            const installing = reg.installing;
            if (installing) {
              installing.onstatechange = () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  installing.postMessage({ type: 'SKIP_WAITING' });
                }
              };
            }
          };

          // Periodically check for updates every 15 minutes
          setInterval(() => {
            if (navigator.onLine) {
              reg.update().catch(() => {});
            }
          }, 15 * 60 * 1000);
        })
        .catch((err) => {
          console.warn('SAIMETRIC Service Worker registration notice:', err);
        });
    });

    // When connection is restored, immediately check for updates
    window.addEventListener('online', () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) reg.update().catch(() => {});
      });
    });
  }
}

// Request persistent storage so browsers (Chrome, iOS Safari, Edge) do not evict offline data
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persistent) => {
    if (persistent) {
      console.log('SAIMETRIC storage granted persistent status (eviction protected).');
    }
  }).catch((err) => {
    console.warn('Storage persist request warning:', err);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
);


import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary.tsx';
import './index.css';

// Service Worker Registration and Smart Update Management
if ('serviceWorker' in navigator) {
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  if (import.meta.env.DEV || isIframe) {
    // DEV MODE:
    // Ensure Service Worker does NOT auto-reload the page when a new update is found in Dev mode.
    // It should only log a console message: [SW] New version available.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.onupdatefound = () => {
          const installing = reg.installing;
          if (installing) {
            installing.onstatechange = () => {
              if (installing.state === 'installed') {
                console.log('[SW] New version available');
              }
            };
          }
        };
      }
    }).catch(() => {});
  } else {
    // PRODUCTION MODE (e.g., Vercel deployment):
    // Smart Update (Update-on-Reload) Pattern
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('SAIMETRIC Service Worker active:', reg.scope);

          // If a new worker is already waiting in the background
          if (reg.waiting) {
            window.dispatchEvent(
              new CustomEvent('saimetric_update_ready', {
                detail: { registration: reg, waitingWorker: reg.waiting },
              })
            );
          }

          // 1. Listen for SW Updates: Register the Service Worker. When onupdatefound fires, listen for state === 'installed'.
          reg.onupdatefound = () => {
            const installing = reg.installing;
            if (installing) {
              installing.onstatechange = () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  // 2. Dispatch custom event saimetric_update_ready
                  window.dispatchEvent(
                    new CustomEvent('saimetric_update_ready', {
                      detail: { registration: reg, waitingWorker: installing },
                    })
                  );
                }
              };
            }
          };

          // 4. Auto-Check: Every 30 minutes, call registration.update() silently to check for new versions
          setInterval(() => {
            if (navigator.onLine) {
              reg.update().catch(() => {});
            }
          }, 30 * 60 * 1000);
        })
        .catch((err) => {
          console.warn('SAIMETRIC Service Worker registration notice:', err);
        });
    });

    // When connection is restored, silently check for updates
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

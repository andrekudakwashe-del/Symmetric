import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary.tsx';
import { initPWAUpdateManager } from './services/pwaUpdateManager';
import './index.css';

// Full-app offline precaching & checkout-safe Service Worker lifecycle (Phase 4A)
initPWAUpdateManager();

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

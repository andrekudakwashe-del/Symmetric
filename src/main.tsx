import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary.tsx';
import './index.css';

// Register Service Worker immediately for 100% offline access and Chrome WebAPK PWA installation
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((reg) => {
      console.log('SAIMETRIC Service Worker active:', reg.scope);
    })
    .catch((err) => {
      console.warn('SAIMETRIC Service Worker registration notice:', err);
    });
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


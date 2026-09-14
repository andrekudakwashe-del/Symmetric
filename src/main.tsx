import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

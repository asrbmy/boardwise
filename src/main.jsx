import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Offline support: the service worker precaches the app shell. No network is used at runtime otherwise.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true, onOfflineReady() { window.dispatchEvent(new CustomEvent('bw-offline-ready')); } });
  }).catch(() => {});
}

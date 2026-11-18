import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Strict CSP injected at build time only (dev server needs inline HMR scripts).
// connect-src is 'self' only: the app itself never talks to the network.
// WebRTC peer connections are not governed by connect-src.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' data: blob:",
  "form-action 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function cspPlugin() {
  return {
    name: 'boardwise-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE || process.env.BASE_PATH || './';
  return {
    base,
    plugins: [
      react(),
      cspPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['icon.svg'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
        manifest: {
          name: 'Boardwise',
          short_name: 'Boardwise',
          description: 'Private, offline infinite whiteboard',
          theme_color: '#1f4fd8',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: base === './' ? './' : base,
          scope: base === './' ? './' : base,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.js'],
      setupFiles: ['tests/setup.js'],
    },
  };
});

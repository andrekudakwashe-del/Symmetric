import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function disableHmrClientSocketPlugin(): Plugin {
  let hmrDisabled = false;
  return {
    name: 'saimetric-disable-hmr-client-socket',
    apply: 'serve',
    enforce: 'post',
    configResolved(config) {
      hmrDisabled = config.server.hmr === false;
    },
    transform(code, id) {
      if (!hmrDisabled) return null;
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.includes('vite/dist/client/client.mjs') && !normalizedId.includes('@vite/client')) {
        return null;
      }
      const startMarker = 'const transport = normalizeModuleRunnerTransport(';
      const endMarker = '\nlet willUnload = false;';
      const startIdx = code.indexOf(startMarker);
      const endIdx = code.indexOf(endMarker);
      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        return null;
      }
      const noopTransport =
        'const transport = normalizeModuleRunnerTransport({\n' +
        '  async connect() {},\n' +
        '  async disconnect() {},\n' +
        '  send() {},\n' +
        '});';
      return {
        code: code.slice(0, startIdx) + noopTransport + code.slice(endIdx),
        map: null,
      };
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      disableHmrClientSocketPlugin(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifestFilename: 'manifest.json',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'SAIMETRIC POS & Retail ERP',
          short_name: 'SAIMETRIC',
          description:
            'Offline-First Retail ERP & POS system with multi-currency, branch isolation, and dual-layer local backup.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/Code.gs', '**/termux-hub.js', '**/hub-ota/**'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/hub-ota\//],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^\/hub-ota\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
        },
      }),
    ],
    esbuild: {
      sourcemap: false,
    },
    css: {
      devSourcemap: false,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      allowedHosts: true,
      // Default Vite HMR without aggressive error overlay reload or polling
      hmr: process.env.DISABLE_HMR === 'true' ? false : { overlay: false },
      watch: process.env.DISABLE_HMR === 'true' ? null : { usePolling: false },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('xlsx')) return 'vendor-xlsx';
              if (id.includes('recharts')) return 'vendor-charts';
              if (id.includes('mqtt')) return 'vendor-mqtt';
              if (id.includes('html5-qrcode')) return 'vendor-qr-scanner';
              if (id.includes('qrcode')) return 'vendor-qr-gen';
              if (id.includes('lucide-react')) return 'vendor-icons';
              return 'vendor-core';
            }
          },
        },
      },
    },
  };
});

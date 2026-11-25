import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
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

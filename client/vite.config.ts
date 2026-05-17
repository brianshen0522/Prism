import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rawBase = (process.env.VITE_BASE_PATH ?? '').trim().replace(/\/+$/, '');
const bp = rawBase && !rawBase.startsWith('/') ? `/${rawBase}` : rawBase;
const base = bp ? `${bp}/` : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      [`${bp}/api`]: { target: 'http://localhost:3000', changeOrigin: true },
      [`${bp}/ws`]: { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});

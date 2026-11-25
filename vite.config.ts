import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend lives in web/, builds to ./dist which the Worker serves as static assets.
// In dev, /api is proxied to `wrangler dev` on :8788.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    host: true,
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:8788', changeOrigin: true } },
  },
  test: {
    root: '.',
    include: ['worker/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.ts'],
  },
} as any);

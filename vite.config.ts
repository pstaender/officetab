/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { precacheServiceWorker } from './tools/build/precache-plugin.ts';

// `base: './'` makes every emitted URL relative, so `dist/` can be dropped into
// any directory of any static web server without configuration.
export default defineConfig({
  base: './',
  plugins: [react(), precacheServiceWorker()],
  resolve: {
    alias: {
      '@lo': fileURLToPath(new URL('./src/lo', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
    },
  },
  build: { target: 'esnext', sourcemap: false, chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});

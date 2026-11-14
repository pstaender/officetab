/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { precacheServiceWorker } from './tools/build/precache-plugin.ts';
import { APPS } from './src/shell/apps.ts';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The suite is one multi-page build. Vite's root is src/, so each page keeps its directory:
// src/index.html (the Start Center) becomes dist/index.html, src/writer/index.html
// dist/writer/index.html. The apps share their chunks (src/lo, src/shell) and one service worker.
//
// `base: './'` makes every emitted URL relative, so `dist/` can be dropped into
// any directory of any static web server without configuration.
export default defineConfig({
  root: path('./src'),
  base: './',
  publicDir: path('./public'),
  cacheDir: path('./node_modules/.vite'),
  plugins: [react(), precacheServiceWorker()],
  resolve: {
    alias: {
      '@lo': path('./src/lo'),
      '@shell': path('./src/shell'),
    },
  },
  build: {
    outDir: path('./dist'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: { index: path('./src/index.html'), ...Object.fromEntries(APPS.map((a) => [a.id, path(`./src/${a.id}/index.html`)])) },
    },
  },
  test: { root: path('.'), include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});

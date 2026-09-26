// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/vite.config.ts), see NOTICE.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// In development the browser talks to Vite only, which forwards the API's paths, so the
// console sees a same-origin API exactly as it does behind nginx in Docker.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

// The public demo (#41, ADR-0021). VITE_ERP_DEMO=1 builds in the in-browser demo API; any
// other build compiles it away (`__ERP_DEMO__` is a constant). VITE_BASE_PATH serves the
// console under a sub-path, /PaynEat-ERP/ on GitHub Pages.
const demo = process.env.VITE_ERP_DEMO === '1';
const backendSource = fileURLToPath(new URL('../backend', import.meta.url));
const base = process.env.VITE_BASE_PATH ?? '/';

/**
 * GitHub Pages sets no response headers, so the demo build carries the policy of
 * security-headers.conf in a <meta>. `frame-ancestors` is the one directive a <meta> cannot
 * carry, and is left out.
 */
const DEMO_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'self'; form-action 'self'";

/**
 * What the demo build adds for GitHub Pages: the policy above, and a 404.html that is the
 * console itself, since Pages has no rewrites and a deep link such as /PaynEat-ERP/items
 * would otherwise be Pages' own "not found".
 */
function githubPagesDemo(): Plugin {
  let outDir = 'dist';
  return {
    name: 'payneat-erp-github-pages-demo',
    apply: 'build',
    configResolved: (config) => {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: DEMO_CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
    closeBundle: () => {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  base,
  define: { __ERP_DEMO__: JSON.stringify(demo) },
  plugins: [react(), ...(demo ? [githubPagesDemo()] : [])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The public demo runs the backend's own pure rules and demo data (ADR-0021); only
      // src/demo imports them, and only those files (eslint.config.js).
      '@backend': backendSource,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        `${backendSource}/src`,
        `${backendSource}/prisma`,
      ],
    },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/health': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});

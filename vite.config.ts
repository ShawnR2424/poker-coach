/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig({
  plugins: [react(), serviceWorker()],
  base: './',
  // A classic (non-module) worker script: WebKit refused to start the module build.
  worker: { format: 'iife' },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

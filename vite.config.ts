/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig({
  plugins: [react(), serviceWorker()],
  base: './',
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

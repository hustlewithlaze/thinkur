/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handleApi } from './server/ai.mjs';

/** Mounts the server-side /api routes into the Vite dev server so the API key never reaches the client bundle. */
const api = (): Plugin => ({
  name: 'thinkur-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!(await handleApi(req, res))) next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!(await handleApi(req, res))) next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), api()],
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});

import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const sharedIndex = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
const sharedLogger = fileURLToPath(new URL('../../packages/shared/src/logger.ts', import.meta.url));
const promptsIndex = fileURLToPath(
  new URL('../../packages/prompts/src/index.ts', import.meta.url),
);

export default defineConfig(({ mode }) => {
  // Load every var (including non-VITE_ ones) so the dev server can proxy to the API.
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4000';

  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      // Workspace packages are consumed from source: no build step needed.
      // Order matters - the more specific subpath must come first.
      alias: {
        '@creatordna/shared/logger': sharedLogger,
        '@creatordna/shared': sharedIndex,
        '@creatordna/prompts': promptsIndex,
      },
    },

    server: {
      // 0.0.0.0 so the preview host can reach the dev server.
      host: true,
      port: 5173,
      allowedHosts: true,
      proxy: {
        // Relative URLs in the browser -> the API process.
        '/api': { target: apiProxyTarget, changeOrigin: true },
        '/health': { target: apiProxyTarget, changeOrigin: true },
        '/ws': { target: apiProxyTarget, changeOrigin: true, ws: true },
      },
    },

    preview: {
      host: true,
      port: 4173,
    },

    build: {
      outDir: 'dist',
      sourcemap: true,
    },

    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      // Tailwind is not needed for component tests.
      css: false,
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  };
});

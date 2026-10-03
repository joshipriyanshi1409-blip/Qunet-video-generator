import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sharedIndex = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const sharedLogger = fileURLToPath(new URL('../shared/src/logger.ts', import.meta.url));

export default defineConfig({
  resolve: {
    // Workspace packages are consumed from source: no build step needed.
    // Order matters - the more specific subpath must come first.
    alias: {
      '@creatordna/shared/logger': sharedLogger,
      '@creatordna/shared': sharedIndex,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

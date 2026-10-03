import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sharedIndex = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
const sharedLogger = fileURLToPath(new URL('../../packages/shared/src/logger.ts', import.meta.url));
const promptsIndex = fileURLToPath(new URL('../../packages/prompts/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against the workspace sources, so no build step is needed first.
    // Order matters: the more specific subpath must come first.
    alias: {
      '@creatordna/shared/logger': sharedLogger,
      '@creatordna/shared': sharedIndex,
      '@creatordna/prompts': promptsIndex,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

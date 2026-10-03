import { createLogger, type Logger } from '@creatordna/shared/logger';
import { createConfig, type AppConfig } from '../config/index.js';
import { parseApiEnv } from '../config/env.js';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return createConfig(
    parseApiEnv({
      NODE_ENV: 'test',
      LOG_PRETTY: 'false',
      LOG_LEVEL: 'silent',
      ...overrides,
    }),
  );
}

export function testLogger(): Logger {
  return createLogger({ level: 'silent' });
}

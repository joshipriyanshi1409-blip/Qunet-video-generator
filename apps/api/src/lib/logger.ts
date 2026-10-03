import { createLogger, type Logger } from '@creatordna/shared/logger';
import type { AppConfig } from '../config/index.js';

export function createApiLogger(config: AppConfig): Logger {
  return createLogger({
    level: config.env.LOG_LEVEL,
    // Pretty printing is a dev-only affordance; production logs stay JSON.
    pretty: config.env.LOG_PRETTY,
    base: {
      service: config.serviceName,
      version: config.version,
      env: config.env.NODE_ENV,
    },
  });
}

export function createChildLogger(logger: Logger, bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

import { createLogger, type Logger } from '@creatordna/shared/logger';
import type { WorkerConfig } from '../config/index.js';

export function createWorkerLogger(config: WorkerConfig): Logger {
  return createLogger({
    level: config.env.LOG_LEVEL,
    pretty: config.env.LOG_PRETTY,
    base: {
      service: config.serviceName,
      version: config.version,
      env: config.env.NODE_ENV,
    },
  });
}

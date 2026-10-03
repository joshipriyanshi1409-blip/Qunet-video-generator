import pino, { type DestinationStream, type Logger } from 'pino';

// Re-exported so consumers get the exact same pino types from this subpath.
export type { DestinationStream, Logger };

/** Paths that must never reach the logs. */
export const DEFAULT_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-dev-uid"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.firebasePrivateKey',
  'FIREBASE_PRIVATE_KEY',
];

export interface CreateLoggerOptions {
  /** pino levels plus `silent` (used by tests). */
  level?: pino.Level | 'silent';
  /** Pretty-print with pino-pretty (dev only - never enable in production). */
  pretty?: boolean;
  name?: string;
  /** Extra fields attached to every log line. */
  base?: Record<string, unknown>;
  redact?: string[];
  /** Injectable stream (used by tests to capture log lines). */
  destination?: DestinationStream;
}

/**
 * One logger factory for the whole monorepo so every service emits the same
 * structured shape: `{ level, time, service, msg, ... }`.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const {
    level = 'info',
    pretty = false,
    name = 'creatordna',
    base = {},
    redact = DEFAULT_REDACT_PATHS,
    destination,
  } = options;

  return pino(
    {
      level: level as pino.Level,
      name,
      base,
      redact,
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname,name',
              },
            },
          }
        : {}),
    },
    destination,
  );
}

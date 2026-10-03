import 'dotenv/config';
import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import { EnvValidationError, parseWorkerEnv } from './config/env.js';
import { createConfig, type WorkerConfig } from './config/index.js';
import { createWorkerLogger } from './lib/logger.js';
import { createRenderDeps } from './lib/renderDeps.js';
import { createWorkers } from './queues/index.js';

async function main(): Promise<void> {
  // --- boot: fail fast on a bad environment -------------------------------
  let env;
  try {
    env = parseWorkerEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`\n[creatordna-worker] ${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const config = createConfig(env);
  const logger = createWorkerLogger(config);

  if (!config.env.REDIS_ENABLED) {
    logger.warn('REDIS_ENABLED=false - no queues to process, exiting');
    return;
  }

  // Firebase is optional in development: without it the worker writes job
  // documents to a local JSON file and assets to a local directory, which is
  // enough to run the whole pipeline and watch it in the UI.
  const firebase = await loadFirebase(config, logger);

  // No model id configured means the pipeline runs on mock assets. That is a
  // supported way to run CreatorDNA, not a degraded one - and the only way to
  // exercise a render end to end without spending money.
  const renderDeps = await createRenderDeps({
    config,
    logger,
    firestore: firebase?.firestore ?? null,
    storage: firebase?.storage ?? null,
    redis: config.redis,
  });

  const workers = createWorkers({
    connection: config.redis,
    logger,
    concurrency: config.env.WORKER_CONCURRENCY,
    prefix: config.env.QUEUE_PREFIX,
    render: renderDeps,
  });

  logger.info(
    {
      queues: [workers.ping.name, workers.render.name],
      concurrency: config.env.WORKER_CONCURRENCY,
      redis: config.env.REDIS_URL,
      prefix: config.env.QUEUE_PREFIX,
    },
    'worker started',
  );

  // --- graceful shutdown ---------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out - forcing exit');
      process.exit(1);
    }, config.env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await workers.close();
      logger.info('shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception - exiting');
    process.exit(1);
  });
}

interface FirebaseHandles {
  firestore: Firestore;
  storage: Storage;
}

/**
 * Loads Firebase Admin, or returns null when it is not configured.
 *
 * A missing service account is not a boot failure outside production: the worker
 * can run the whole pipeline against local files, and a stack trace about a
 * private key would be noise for someone who never intended to deploy.
 */
async function loadFirebase(
  config: WorkerConfig,
  logger: ReturnType<typeof createWorkerLogger>,
): Promise<FirebaseHandles | null> {
  const env = config.env;
  if (
    env.FIREBASE_PROJECT_ID === undefined ||
    env.FIREBASE_CLIENT_EMAIL === undefined ||
    env.FIREBASE_PRIVATE_KEY === undefined
  ) {
    logger.warn(
      'Firebase credentials are not set - job documents and assets will be written locally',
    );
    return null;
  }

  // Imported dynamically so a deployment without firebase-admin installed still
  // boots the queue side of the worker.
  const admin = await import('firebase-admin');
  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // `.env` files cannot hold a literal newline, so the key arrives escaped.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
  });

  logger.info({ projectId: env.FIREBASE_PROJECT_ID }, 'firebase admin ready');
  return { firestore: admin.firestore(app), storage: admin.storage(app) };
}

main().catch((error: unknown) => {
  console.error('[creatordna-worker] failed to start', error);
  process.exit(1);
});

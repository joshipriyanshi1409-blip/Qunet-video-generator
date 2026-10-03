/**
 * Seeds the trend catalogue.
 *
 * Writes the 20 formats from `src/lib/trendRepository.ts` into Firestore when a
 * project is configured, otherwise into the local JSON file. Idempotent: it only
 * writes ids that are missing, so it is safe to run on every boot and in CI.
 *
 * Run with:  pnpm --filter @creatordna/api seed:trends
 */
import { createConfig } from '../src/config/index.js';
import { EnvValidationError, parseApiEnv } from '../src/config/env.js';
import { createApiLogger } from '../src/lib/logger.js';
import { initFirebaseAdmin, getFirestoreDb, shutdownFirebaseAdmin } from '../src/lib/firebase-admin.js';
import {
  createFirestoreTrendRepository,
  createLocalFileTrendRepository,
} from '../src/lib/trendRepository.js';

async function main(): Promise<void> {
  let env;
  try {
    env = parseApiEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`\n[creatordna-seed] ${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const config = createConfig(env);
  const logger = createApiLogger(config);

  initFirebaseAdmin(config, logger);
  const firestore = getFirestoreDb();

  const repository =
    firestore === null
      ? createLocalFileTrendRepository(config.env.TRENDS_STORE_PATH)
      : createFirestoreTrendRepository(firestore);

  const written = await repository.seed();
  const total = (await repository.list()).length;

  logger.info(
    { written, total, kind: repository.kind, path: config.env.TRENDS_STORE_PATH },
    written > 0 ? 'trend catalogue seeded' : 'trend catalogue already up to date',
  );

  await shutdownFirebaseAdmin();

  if (written > 0) {
    console.log(`Seeded ${written} trend(s); catalogue now holds ${total}.`);
  } else {
    console.log(`Nothing to do - catalogue already holds ${total} trend(s).`);
  }
}

await main();

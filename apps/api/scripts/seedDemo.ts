/**
 * Seeds a demo creator and warms the demo render cache.
 *
 * A demo has to be repeatable, offline and fast, which rules out "sign up, pick
 * a trend, wait for Veo". So this script does three things:
 *
 *  1. Writes a complete Creator DNA for a fixed demo account, so every screen
 *     has something to render against and the score ring is not empty.
 *  2. Runs one render through the real pipeline in mock mode, which warms the
 *     demo cache and produces the **golden video** - the artifact a presenter
 *     shows when the network is gone.
 *  3. Prints the account and the paths, so the next person does not have to
 *     read this file to find them.
 *
 * It is idempotent: the DNA is overwritten with the same values, and a warm
 * cache is reused rather than re-rendered. Safe to run on every deploy.
 *
 * Run with:  pnpm --filter @creatordna/api seed:demo
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { creatorDnaSchema, type CreatorDna, type RenderJob } from '@creatordna/shared';
import {
  createDemoAssetCache,
  createLocalDiskAssetStore,
  createMockRenderAi,
  createMemoryRenderJobRepository,
  resolveComposer,
  runRenderPipeline,
  withDemoCache,
} from '@creatordna/render';
import { createConfig } from '../src/config/index.js';
import { EnvValidationError, parseApiEnv } from '../src/config/env.js';
import { createApiLogger } from '../src/lib/logger.js';
import { initFirebaseAdmin, getFirestoreDb, shutdownFirebaseAdmin } from '../src/lib/firebase-admin.js';
import {
  createFirestoreDnaRepository,
  createLocalFileDnaRepository,
  type DnaRepository,
} from '../src/lib/dnaRepository.js';

/**
 * The demo creator.
 *
 * A fixed uid, not a random one: a demo has to be findable by the presenter and
 * by anyone reading the logs afterwards. With `DEV_AUTH_BYPASS` this is the
 * `x-dev-uid` / `?dev_uid=` value; in a real deployment it is the Firebase uid
 * of the account the presenter signs in as.
 */
export const DEMO_UID = 'demo-creator';

/** 9:16, the product's frame. */
const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;

const demoDna: CreatorDna = creatorDnaSchema.parse({
  niche: 'DSA interview prep for career switchers',
  audienceAgeRange: '25-34',
  audienceType: 'professionals',
  tone: ['direct', 'practical'],
  audience: ['Career switchers', 'Students'],
  style: 'Short sentences, whiteboard, fast cuts',
  personality: ['blunt', 'encouraging'],
  format: 'whiteboard',
  vocabulary: ['amortized', 'invariant', 'off-by-one'],
  catchphrases: ['Binary search in 30 seconds.', 'Draw the search space.'],
  dos: ['dry run the code on screen', 'name the bug out loud'],
  donts: ['jargon dumps', 'apologising for the maths'],
  samplePosts: [
    { text: 'Binary search in 30 seconds. The search space halves every step.' },
    { text: 'Your loop never terminates? Print the mid. It is not moving.' },
  ],
});

/** The script the golden render walks. Three beats is the product's rhythm. */
const demoScript = [
  { scene: 'Hook', text: 'Binary search in 30 seconds. The search space halves every step.' },
  { scene: 'Turn', text: 'Print the mid. If it never moves, that is your bug.' },
  { scene: 'CTA', text: 'Follow for the next data structure in plain English.' },
];

const demoPayload = {
  projectId: 'demo-project',
  hook: 'Binary search in 30 seconds.',
  script: demoScript,
  cta: 'Follow for the next data structure in plain English.',
  caption: 'Binary search in 30 seconds.',
  hashtags: ['#dsa', '#interviewprep'],
  dnaVersion: demoDna.dnaVersion,
};

async function main(): Promise<void> {
  let env;
  try {
    env = parseApiEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`\n[seed:demo] ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const config = createConfig(env);
  const logger = createApiLogger(config);

  // --- 1. the demo creator's DNA -------------------------------------------
  initFirebaseAdmin(config, logger);
  const db = getFirestoreDb();
  const dna: DnaRepository =
    db === null
      ? createLocalFileDnaRepository(env.DNA_STORE_DIR)
      : createFirestoreDnaRepository(db);
  await dna.save(DEMO_UID, demoDna);
  logger.info({ uid: DEMO_UID, store: dna.kind, version: demoDna.dnaVersion }, 'demo DNA written');

  // --- 2. the golden render -------------------------------------------------
  const dataDir = env.RENDER_ASSET_DIR;
  // The same path the worker reads when DEMO_MODE=true, so a cache warmed here
  // is a cache the worker will actually hit.
  const cacheDir = env.DEMO_CACHE_DIR;
  const workRoot = join(dataDir, 'work');

  // Start from a clean work area so a failed previous run cannot be mistaken
  // for this one's output.
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });

  const cache = createDemoAssetCache({ dir: cacheDir, logger });
  const ai = withDemoCache(createMockRenderAi(), cache);

  // The real composer when ffmpeg is installed, the mock otherwise - and the
  // log line below says which, because a 600-byte "video" is not a demo anyone
  // should discover by playing it.
  const composer = await resolveComposer({ mode: env.RENDER_COMPOSER, binary: env.FFMPEG_PATH });

  // Storage: the local disk store, because the point of the golden render is
  // that it exists without a bucket. The API already serves this directory.
  // `RENDER_ASSET_DIR` is already the assets directory (`.data/assets`), the
  // same place the worker's local-disk store writes and the API serves.
  const store = createLocalDiskAssetStore({
    root: dataDir,
    publicBaseUrl: env.RENDER_ASSET_MOUNT,
  });

  const repository = createMemoryRenderJobRepository();
  const jobId = `demo-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const job: RenderJob = {
    jobId,
    uid: DEMO_UID,
    queue: 'render',
    // `state` is the queue's state, `stage` is the pipeline's. They are not the
    // same axis, and a brand-new job is waiting in the queue at stage `queued`.
    state: 'waiting',
    stage: 'queued',
    progress: 0,
    assets: [],
    error: null,
    attemptsMade: 0,
    payload: demoPayload,
    dna: demoDna,
    createdAt: now,
    updatedAt: now,
  };
  await repository.save(job);

  const result = await runRenderPipeline({
    repository,
    store,
    ai,
    composer,
    logger,
    events: null,
    workRoot,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  }, jobId);

  if (result.stage !== 'completed') {
    console.error(`\n[seed:demo] the golden render failed: ${result.message}\n`);
    await shutdownFirebaseAdmin();
    process.exit(1);
  }

  const video = (await repository.get(jobId))?.assets.find((asset) => asset.kind === 'mp4');
  await shutdownFirebaseAdmin();

  console.log(`
[seed:demo] done.

  Demo creator   ${DEMO_UID}
  DNA            ${dna.kind} (version ${demoDna.dnaVersion}, score recomputed on read)
  Golden video   ${video?.url ?? '(no video asset recorded)'}
  Demo cache     ${cacheDir}
  Job            ${jobId}

  Sign in as ${DEMO_UID} with DEV_AUTH_BYPASS=true, then open /create and render
  anything - with DEMO_MODE=true the worker serves every stage from the cache
  above and finishes in seconds with no API key.
`);
}

main().catch((error: unknown) => {
  console.error(`\n[seed:demo] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

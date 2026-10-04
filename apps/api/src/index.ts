import 'dotenv/config';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { creatorDnaSchema, type RenderProgressEvent } from '@creatordna/shared';
import {
  createDemoAssetCache,
  createLocalDiskAssetStore,
  createMockRenderAi,
  resolveComposer,
  runRenderPipeline,
  withDemoCache,
} from '@creatordna/render';
import { createApp } from './app.js';
import { createConfig } from './config/index.js';
import { EnvValidationError, parseApiEnv, type ApiEnv } from './config/env.js';
import {
  getFirestoreDb,
  initFirebaseAdmin,
  shutdownFirebaseAdmin,
} from './lib/firebase-admin.js';
import { createApiLogger } from './lib/logger.js';
import { closeQueues, createQueues } from './lib/queues.js';
import {
  createFirestoreDnaRepository,
  createLocalFileDnaRepository,
  type DnaRepository,
} from './lib/dnaRepository.js';
import {
  createFirestoreDnaLearningRepository,
  createLocalFileDnaLearningRepository,
} from './lib/dnaLearningRepository.js';
import { createCache } from './lib/cache.js';
import {
  createFirestoreProjectRepository,
  createLocalFileProjectRepository,
  type ProjectRepository,
} from './lib/projectRepository.js';
import {
  createFirestoreTrendRepository,
  createLocalFileTrendRepository,
  type TrendRepository,
} from './lib/trendRepository.js';
import { closeRedisClient, createRedisClient, redisOptions } from './lib/redis.js';
import {
  createFirestoreRenderJobRepository,
  createLocalFileRenderJobRepository,
  type RenderJobRepository,
} from './lib/renderJobRepository.js';
import { createRenderEventBus } from './lib/renderEvents.js';
import { renderChannel } from './ws/index.js';
import {
  createGeminiRestClient,
  createStubTextModelClient,
  createTextModelService,
} from './services/ai/index.js';
import { createWsServer } from './ws/index.js';
import { verifyIdToken } from './middleware/auth.js';
import { createDnaService } from './services/dna.service.js';
import { createDnaLearningService } from './services/dnaLearning.service.js';
import { createDnaLearningScheduler } from './lib/dnaLearningScheduler.js';
import { createTrendService } from './services/trend.service.js';
import { createAudienceService } from './services/audience.service.js';
import { createRenderJobService } from './services/renderJob.service.js';
import {
  createLiveProvider,
  createSessionRegistry,
  createVoiceCoachService,
  createVoiceCoachSocketHandler,
} from './voiceCoach/index.js';

const verifyToken = verifyIdToken;

async function isRedisReachable(redisUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(redisUrl);
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port ? Number(parsed.port) : 6379;
    return await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 250);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve(true);
      });
      socket.once('error', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

const DEFAULT_CREATOR_DNA = creatorDnaSchema.parse({
  niche: 'Tech (CSE)',
  audienceAgeRange: '18-24',
  audienceType: 'students',
  tone: ['friendly', 'educational'],
  audience: ['Students (18-24)', 'Beginner Coders', 'Working Developers'],
  style: 'Friendly - Educational',
  personality: ['relatable', 'encouraging'],
  format: 'talking-head',
  vocabulary: ['binary search', 'log n', 'sorted array', 'DSA'],
  catchphrases: [
    'Binary search in 30 seconds',
    'Binary Search Made Easy',
  ],
  dos: ['use practical examples', 'relatable student stories'],
  donts: ['dry theory dumps', 'skip visual walkthroughs'],
  samplePosts: [
    { text: 'POV: You finally understand Binary Search after 3 days. Binary Search Made Easy!' },
    { text: 'A day in my life as a CSE student prepping for coding interviews.' },
  ],
  dnaVersion: 3,
});

async function main(): Promise<void> {
  if ((process.env.NODE_ENV ?? 'development') === 'development') {
    if (process.env.DEV_AUTH_BYPASS === undefined) {
      process.env.DEV_AUTH_BYPASS = 'true';
    }
    if (process.env.GEMINI_API_KEY === undefined && process.env.AI_STUB_CLIENT === undefined) {
      process.env.AI_STUB_CLIENT = 'true';
    }
    if (process.env.REDIS_ENABLED === undefined) {
      const reachable = await isRedisReachable(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
      if (!reachable) {
        process.env.REDIS_ENABLED = 'false';
      }
    }
  }

  // --- boot: fail fast on a bad environment -------------------------------
  let env: ApiEnv;
  try {
    env = parseApiEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`\n[creatordna-api] ${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const config = createConfig(env);
  const logger = createApiLogger(config);

  if (config.env.DEV_AUTH_BYPASS) {
    logger.warn(
      'DEV_AUTH_BYPASS=true - protected endpoints trust the x-dev-uid header. This must never be enabled in production.',
    );
  }

  initFirebaseAdmin(config, logger);

  const redis = createRedisClient(config, logger);
  const queues = createQueues(config, logger);

  // --- creator dna: Firestore when configured, a local file otherwise -----
  const firestore = getFirestoreDb();
  const dnaRepository: DnaRepository =
    firestore === null
      ? createLocalFileDnaRepository(config.env.DNA_STORE_DIR)
      : createFirestoreDnaRepository(firestore);

  if (firestore === null) {
    logger.warn(
      { directory: config.env.DNA_STORE_DIR },
      'Firestore is not configured - Creator DNA is stored in a local file (development only).',
    );
    for (const defaultUid of ['local-creator', 'demo-creator']) {
      const existing = await dnaRepository.get(defaultUid).catch(() => null);
      if (existing === null) {
        await dnaRepository.save(defaultUid, DEFAULT_CREATOR_DNA);
        logger.info({ uid: defaultUid }, 'seeded default Creator DNA profile');
      }
    }
  } else {
    logger.info('creator dna repository: firestore');
  }

  // --- ai wrapper ---------------------------------------------------------
  // No API key means no model call: extraction returns a clear 503 rather than
  // silently using a hard-coded model id. `AI_STUB_CLIENT` is the documented
  // dev-only way to demo the flow without a key (refused in production).
  const useStub = config.env.AI_STUB_CLIENT;
  const ai =
    config.env.GEMINI_API_KEY === undefined && !useStub
      ? undefined
      : createTextModelService({
          client: useStub
            ? createStubTextModelClient({ name: 'gemini-rest' })
            : createGeminiRestClient({ apiKey: config.env.GEMINI_API_KEY ?? '' }),
          logger,
          primaryModel: useStub ? 'stub-model' : (config.models.geminiText ?? ''),
          fallbackModel: useStub ? undefined : config.models.fallback,
          maxAttempts: config.env.AI_MAX_ATTEMPTS,
          timeoutMs: config.env.AI_TIMEOUT_MS,
          temperature: config.env.AI_TEMPERATURE,
          maxOutputTokens: config.env.AI_MAX_OUTPUT_TOKENS,
          inputPricePer1k: config.env.AI_COST_PER_1K_INPUT_TOKENS,
          outputPricePer1k: config.env.AI_COST_PER_1K_OUTPUT_TOKENS,
        });

  if (useStub) {
    logger.warn(
      'AI_STUB_CLIENT=true - DNA extraction uses the dev stub model. Never enable this in production.',
    );
  } else if (ai === undefined) {
    logger.warn(
      'GEMINI_API_KEY is not set - DNA extraction is unavailable (set GEMINI_API_KEY and GEMINI_TEXT_MODEL, or AI_STUB_CLIENT=true to demo without a key).',
    );
  }

  // One DNA service per process, shared by the /dna routes and by Trend Remix
  // (which needs the same profile and the same context builder).
  const dnaService =
    dnaRepository === null || ai === undefined
      ? undefined
      : createDnaService({
          repository: dnaRepository,
          ai,
          logger,
          historyLimit: config.env.DNA_HISTORY_LIMIT,
        });

  // --- phase 4: trends ----------------------------------------------------
  // The cache is shared (Redis) when available and in-memory otherwise, so the
  // one-hour ranking cache works either way.
  const cache = createCache({
    redis,
    logger,
    prefix: `${config.env.QUEUE_PREFIX}:cache`,
  });

  const trendRepository: TrendRepository =
    firestore === null
      ? createLocalFileTrendRepository(config.env.TRENDS_STORE_PATH)
      : createFirestoreTrendRepository(firestore);

  const seeded = await trendRepository.seed();
  if (seeded > 0) {
    logger.info({ written: seeded }, 'trend catalogue seeded');
  }
  logger.info({ kind: trendRepository.kind }, 'trend repository ready');

  const trendService =
    dnaService === undefined || ai === undefined
      ? undefined
      : createTrendService({
          repository: trendRepository,
          dna: dnaService,
          ai,
          cache,
          logger,
          rankingTtlMs: config.env.TRENDS_CACHE_TTL_MS,
          generationTtlMs: config.env.TREND_CACHE_TTL_MS,
          modelWeight: config.env.TREND_MODEL_WEIGHT,
        });

  // --- phase 9: the learning loop ------------------------------------------
  // Separate repository from the profile: append-heavy history that a background
  // job reads, not a document a creator edits.
  const dnaLearningRepository =
    firestore === null
      ? createLocalFileDnaLearningRepository(config.env.DNA_STORE_DIR + '/learning')
      : createFirestoreDnaLearningRepository(firestore);

  const dnaLearningService =
    dnaService === undefined || ai === undefined
      ? undefined
      : createDnaLearningService({
          learning: dnaLearningRepository,
          dna: dnaRepository,
          ai,
          logger,
          signalLimit: config.env.DNA_SIGNAL_LIMIT,
          maxSuggestions: config.env.DNA_MAX_SUGGESTIONS,
        });

  if (dnaLearningService === undefined) {
    logger.warn('the learning loop needs a DNA store and the AI wrapper - /dna/signals is not mounted.');
  } else {
    logger.info({ kind: dnaLearningRepository.kind }, 'dna learning loop ready');
  }

  // The periodic half of the loop. Only started when there is a service to run
  // and the environment has not turned it off.
  const dnaLearningScheduler =
    dnaLearningService === undefined || config.env.DNA_LEARN_ENABLED === false
      ? null
      : createDnaLearningScheduler({
          service: dnaLearningService,
          repository: dnaLearningRepository,
          logger,
          intervalMs: config.env.DNA_LEARN_INTERVAL_MS,
          batchSize: config.env.DNA_LEARN_BATCH_SIZE,
        });

  if (trendService === undefined) {
    logger.warn(
      'trends need both a DNA store and an AI client - /trends is not mounted.',
    );
  }

  const projectRepository: ProjectRepository =
    firestore === null
      ? createLocalFileProjectRepository(config.env.PROJECTS_STORE_PATH)
      : createFirestoreProjectRepository(firestore);
  logger.info({ kind: projectRepository.kind }, 'project repository ready');

  // --- render jobs ---------------------------------------------------------
  // The job document is the source of truth for a render's state, so it gets the
  // same Firestore-or-local-file treatment as the DNA and project stores.
  const renderJobRepository: RenderJobRepository =
    firestore === null
      ? createLocalFileRenderJobRepository(config.env.DNA_STORE_DIR + '/render-jobs.json')
      : createFirestoreRenderJobRepository(firestore);
  logger.info({ kind: renderJobRepository.kind }, 'render job repository ready');

  // The worker publishes progress; this process is the one holding the sockets,
  // so it subscribes and re-broadcasts on the per-job channel.
  const renderEventBus = createRenderEventBus({
    redis: redisOptions(config),
    logger,
    enabled: config.env.REDIS_ENABLED,
  });

  let wsBroadcast: ((channel: string, event: RenderProgressEvent) => void) | null = null;

  const inProcessEnqueue =
    queues !== null
      ? null
      : (jobId: string) => {
          void (async () => {
            try {
              const dataDir = config.env.RENDER_ASSET_DIR;
              const cacheDir = config.env.DEMO_CACHE_DIR;
              const workRoot = join(dataDir, 'work');
              await mkdir(workRoot, { recursive: true });
              const demoCache = createDemoAssetCache({ dir: cacheDir, logger });
              const renderAi = withDemoCache(createMockRenderAi(), demoCache);
              const composer = await resolveComposer({
                mode: config.env.RENDER_COMPOSER,
                binary: config.env.FFMPEG_PATH,
              });
              const store = createLocalDiskAssetStore({
                root: dataDir,
                publicBaseUrl: config.env.RENDER_ASSET_MOUNT,
              });
              const events = {
                publish(event: RenderProgressEvent): Promise<void> {
                  wsBroadcast?.(renderChannel(event.jobId), event);
                  return Promise.resolve();
                },
                close(): Promise<void> {
                  return Promise.resolve();
                },
              };
              await runRenderPipeline(
                {
                  repository: renderJobRepository,
                  store,
                  ai: renderAi,
                  composer,
                  logger,
                  events,
                  workRoot,
                  width: 1080,
                  height: 1920,
                },
                jobId,
              );
            } catch (error) {
              logger.error({ err: error, jobId }, 'in-process render pipeline failed');
            }
          })();
        };

  const renderJobService = createRenderJobService({
    queues,
    logger,
    repository: renderJobRepository,
    events: renderEventBus?.publisher ?? null,
    // The job snapshots the profile it was rendered against, so a retry is
    // reproducible even after the creator edits their DNA.
    dnaRepository,
    inProcessEnqueue,
  });

  const audienceService =
    dnaService === undefined || ai === undefined
      ? undefined
      : createAudienceService({
          repository: projectRepository,
          dna: dnaService,
          ai,
          logger,
        });

  if (audienceService === undefined) {
    logger.warn(
      'the audience mirror needs both a DNA store and an AI client - /audience-mirror is not mounted.',
    );
  }

  // --- phase 6: live voice coach -------------------------------------------
  // An isolated module: the provider is chosen here, and everything downstream
  // of it is the coach's own socket and route.
  const liveRegistry = createSessionRegistry({ logger });

  const liveProvider = createLiveProvider({
    kind: config.env.AI_STUB_CLIENT === true ? 'stub' : 'gemini',
    gemini: {
      apiKey: config.env.GEMINI_API_KEY ?? '',
      baseUrl: config.env.GEMINI_LIVE_BASE_URL,
      apiVersion: config.env.GEMINI_LIVE_API_VERSION,
    },
  });

  const voiceCoachService =
    dnaService === undefined
      ? undefined
      : createVoiceCoachService({
          provider: liveProvider,
          dnaRepository,
          logger,
          model: config.env.GEMINI_LIVE_MODEL,
          registry: liveRegistry,
          async saveSummary(uid, summary, projectId) {
            const headline =
              summary.strengths[0] ?? summary.issues[0] ?? summary.tips[0] ?? 'take reviewed';
            await dnaRepository.appendHistory(
              uid,
              'feedback',
              `Voice coach: ${headline}${projectId === undefined ? '' : ` (${projectId})`}`,
            );
          },
        });

  if (voiceCoachService === undefined) {
    logger.warn('the live voice coach needs a DNA store - /voice-coach is not mounted.');
  } else {
    logger.info({ provider: liveProvider.name }, 'live voice coach ready');
  }

  const voiceCoachSocket =
    voiceCoachService === undefined
      ? undefined
      : createVoiceCoachSocketHandler({
          logger,
          verifyToken,
          devAuthBypass: config.env.DEV_AUTH_BYPASS,
          service: voiceCoachService,
          registry: liveRegistry,
        });

  const app = createApp({
    config,
    logger,
    redis,
    queues,
    verifyToken,
    dnaRepository,
    ai,
    trendService,
    audienceService,
    renderJobService,
    voiceCoachService,
    dnaService,
    dnaLearningService,
    aiRateLimit: config.env.AI_RATE_LIMIT_MAX,
    aiRateLimitWindowMs: config.env.AI_RATE_LIMIT_WINDOW_MS,
  });
  dnaLearningScheduler?.start();

  const server = createServer(app);

  // WebSockets share the HTTP server (single port, single CORS story).
  //
  // Both run with `noServer` and are routed by one `upgrade` handler below: two
  // `WebSocketServer`s both listening on `upgrade` means whichever sees a request
  // for a path it does not own destroys the socket, and the other path then
  // answers `400` on every handshake.
  const ws = createWsServer({
    server,
    config,
    logger,
    verifyToken,
    noServer: true,
    // A socket may only follow its own renders: the channel name is a job id, and
    // the job document is the only thing that says whose job it is.
    renderJobOwner: async (jobId) => {
      const document = await renderJobRepository.get(jobId).catch(() => null);
      return document?.uid ?? null;
    },
  });

  wsBroadcast = (channel, event) => {
    ws.broadcast(channel, event);
  };

  if (firestore === null) {
    const existingDemoJob = await renderJobRepository.get('demo-binary-search').catch(() => null);
    if (existingDemoJob === null && inProcessEnqueue !== null) {
      const now = new Date().toISOString();
      await renderJobRepository.save({
        jobId: 'demo-binary-search',
        uid: 'local-creator',
        queue: 'render',
        state: 'waiting',
        stage: 'queued',
        progress: 0,
        assets: [],
        error: null,
        attemptsMade: 0,
        dna: DEFAULT_CREATOR_DNA,
        payload: {
          projectId: 'demo-project-binary-search',
          hook: 'POV: You finally understand Binary Search after 3 days 😅',
          script: [
            {
              scene: 'Hook',
              text: 'POV: You finally understand Binary Search after 3 days 😅',
            },
            {
              scene: 'Core Idea',
              text: 'Binary search is a simple and efficient algorithm that helps us find an element in a sorted array in log n time.',
            },
            {
              scene: 'CTA',
              text: 'Save this for your next coding interview & follow for more!',
            },
          ],
          cta: 'Save this for your next coding interview & follow for more!',
          caption: 'Binary Search Made Easy ✨ Finally clicked after 3 days of practice!',
          hashtags: ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife'],
          dnaVersion: DEFAULT_CREATOR_DNA.dnaVersion,
        },
        createdAt: now,
        updatedAt: now,
      });
      inProcessEnqueue('demo-binary-search');
    }
  }

  // Worker progress -> Redis pub/sub -> the socket of whoever is watching.
  if (renderEventBus !== null) {
    renderEventBus.subscriber.onEvent((event) => {
      ws.broadcast(renderChannel(event.jobId), event);
    });
  }

  // The coach gets its own path on the same server, so a coaching failure can
  // never take the job-progress channel down with it.
  const coachWss =
    voiceCoachSocket === undefined
      ? null
      : new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  coachWss?.on('connection', (socket, request) => {
    void voiceCoachSocket?.connection(socket, request);
  });

  // One upgrade router for every WebSocket path on this port.
  server.on('upgrade', (request, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (coachWss !== null && pathname === config.env.VOICE_COACH_WS_PATH) {
      coachWss.handleUpgrade(request, socket, head, (client) => {
        coachWss.emit('connection', client, request);
      });
      return;
    }

    if (pathname === ws.wsPath) {
      ws.wss.handleUpgrade(request, socket, head, (client) => {
        ws.wss.emit('connection', client, request);
      });
      return;
    }

    logger.debug({ pathname }, 'websocket upgrade refused: unknown path');
    socket.destroy();
  });

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, env.HOST, () => resolve());
  });

  logger.info(
    {
      url: `http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`,
      apiPrefix: env.API_PREFIX,
      wsPath: '/ws',
      health: '/health',
    },
    'api listening',
  );

  // --- graceful shutdown ---------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    // The learning loop's timer first: a sweep that fires mid-shutdown would
    // start a model call nobody is around to read.
    dnaLearningScheduler?.stop();

    // End live sessions first: a coaching socket outliving the process is a
    // model session nobody is paying for.
    if (voiceCoachSocket !== undefined) {
      await voiceCoachSocket.shutdown();
      await new Promise<void>((resolve) => {
        // A `noServer` WebSocketServer does not terminate its clients on
        // `close()`; without this the HTTP server never finishes shutting down.
        if (coachWss !== null) {
          for (const client of coachWss.clients) client.terminate();
        }
        coachWss?.close(() => resolve());
      });
    }
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out - forcing exit');
      process.exit(1);
    }, config.env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await ws.close();
      server.close();
      server.closeIdleConnections?.();
      await renderEventBus?.subscriber.close();
      await renderEventBus?.publisher.close();
      await closeQueues(queues);
      await closeRedisClient(redis);
      await shutdownFirebaseAdmin();
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

void main().catch((error: unknown) => {
  console.error('[creatordna-api] failed to start', error);
  process.exit(1);
});

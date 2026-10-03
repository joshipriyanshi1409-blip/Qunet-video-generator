import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import cors, { type CorsOptions } from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { AppConfig } from './config/index.js';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  errorHandler,
  notFoundHandler,
} from './lib/errors.js';
import type { QueueRegistry } from './lib/queues.js';
import type { AuthOptions, TokenVerifier } from './middleware/auth.js';
import { requireAuth, verifyIdToken } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { createApiRouter } from './routes/index.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createHealthService } from './services/health.service.js';
import { createPingJobService } from './services/pingJob.service.js';
import { createDnaService, type DnaService } from './services/dna.service.js';
import type { DnaLearningService } from './services/dnaLearning.service.js';
import type { DnaRepository } from './lib/dnaRepository.js';
import type { TextModelService } from './services/ai/index.js';
import type { TrendService } from './services/trend.service.js';
import type { AudienceService } from './services/audience.service.js';
import type { VoiceCoachService } from './voiceCoach/service.js';
import type { RenderJobService } from './services/renderJob.service.js';
import type { Orchestrator } from './services/orchestrator.js';
import type { ScriptCriticService } from './services/scriptCritic.service.js';

export interface CreateAppOptions {
  config: AppConfig;
  logger: Logger;
  /** API's Redis client (producer only). `null` disables queue features. */
  redis?: Redis | null;
  queues?: QueueRegistry | null;
  verifyToken?: TokenVerifier;
  /**
   * Creator DNA store + AI wrapper. Omit both to run without the `/dna` routes;
   * pass `dnaService` instead to reuse an instance built by the boot script.
   */
  dnaRepository?: DnaRepository;
  ai?: TextModelService;
  /** Pre-built DNA service. Takes precedence over `dnaRepository` + `ai`. */
  dnaService?: DnaService;
  /**
   * The learning loop. Omit to run without `/dna/signals`, `/dna/suggestions`
   * and `/dna/versions`; the boot script always builds it when a DNA store and
   * the AI wrapper exist.
   */
  dnaLearningService?: DnaLearningService;
  /** Trend Remix + Hook Lab. Omit to run without the `/trends` routes. */
  trendService?: TrendService;
  audienceService?: AudienceService;
  /** Live Voice Coach. Omit to run without the coach entirely. */
  voiceCoachService?: VoiceCoachService;
  /** Render jobs. Omit to run without the render queue (Redis off). */
  renderJobService?: RenderJobService;
  arenaRouter?: Router;
  /** AI orchestrator for the full video creation pipeline. */
  orchestrator?: Orchestrator;
  /** Script critic for evaluating generated scripts. */
  scriptCritic?: ScriptCriticService;
  /** Per-window limit for the model-backed trend endpoints. */
  aiRateLimit?: number;
  aiRateLimitWindowMs?: number;
}

function corsOptions(config: AppConfig): CorsOptions {
  return {
    origin: (origin, callback) => {
      // No Origin header: curl, server-to-server, health checks.
      if (
        origin === undefined ||
        config.corsOrigins.includes('*') ||
        config.corsOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'cors_origin_not_allowed', `Origin "${origin}" is not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Dev-Uid'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  };
}

/**
 * Builds the Express app (routes -> controllers -> services).
 *
 * Everything is injected so the same factory is used by `pnpm dev` and by tests
 * (which pass `redis: null`, `queues: null` and a stub token verifier).
 */
export function createApp(options: CreateAppOptions): Express {
  const { config, logger } = options;
  const redis = options.redis ?? null;
  const queues = options.queues ?? null;

  const auth: AuthOptions = {
    config,
    logger,
    verifyToken: options.verifyToken ?? verifyIdToken,
  };

  const healthService = createHealthService({ config, redis });
  const pingJobService = createPingJobService({ queues, logger });

  // One DNA service per process: the boot script builds it (so Trend Remix can
  // reuse the same instance), and the fallback here keeps `createApp` usable on
  // its own in tests.
  const dnaService: DnaService | undefined =
    options.dnaService ??
    (options.dnaRepository === undefined || options.ai === undefined
      ? undefined
      : createDnaService({
          repository: options.dnaRepository,
          ai: options.ai,
          logger,
          historyLimit: config.env.DNA_HISTORY_LIMIT,
        }));

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // 1. request logging + correlation id
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => {
        const header = req.headers['x-request-id'];
        return typeof header === 'string' && header.length > 0 ? header : randomUUID();
      },
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/health') === true,
      },
    }),
  );

  // 2. security headers + CORS
  app.use(helmet());
  app.use(cors(corsOptions(config)));

  // 3. body parsing
  app.use(express.json({ limit: config.env.BODY_LIMIT }));

  // 4. health (before the rate limiter - the UI polls it)
  app.use('/health', createHealthRouter(healthService));

  // 5. rate limiting
  app.use(createRateLimiter(config));

  // 6. render assets, when the worker is writing them to the local filesystem.
  //    Production uses Firebase Storage and never reaches this branch.
  //
  //    Authenticated on purpose: the path is `renders/<uid>/<jobId>/...`, so an
  //    unguarded mount would let anyone who learns a URL read another creator's
  //    finished video. That is the same access rule the Firestore rules file
  //    enforces for `users/{uid}/assets`, and it would be odd for the dev path
  //    to be the leaky one.
  if (config.env.RENDER_ASSET_MOUNT.length > 0) {
    app.use(
      config.env.RENDER_ASSET_MOUNT,
      requireAuth(auth),
      ownRenderAsset,
      express.static(config.env.RENDER_ASSET_DIR, {
        // The worker writes the file and then records the URL on the job, so a
        // request that arrives first is a race, not a 404.
        fallthrough: true,
        maxAge: '1h',
        index: false,
      }),
    );
  }

  // 7. API routes
  app.use(
    config.env.API_PREFIX,
    createApiRouter({
      auth,
      pingJobService,
      arenaRouter: options.arenaRouter,
      renderJobService: options.renderJobService,
      dnaService,
      dnaLearningService: options.dnaLearningService,
      trendService: options.trendService,
      audienceService: options.audienceService,
      voiceCoachService: options.voiceCoachService,
      orchestrator: options.orchestrator,
      scriptCritic: options.scriptCritic,
      dnaRepository: options.dnaRepository,
      logger,
      aiRateLimit: options.aiRateLimit,
      aiRateLimitWindowMs: options.aiRateLimitWindowMs,
    }),
  );

  // 8. centralized error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Refuses a render asset that belongs to somebody else.
 *
 * Runs after `requireAuth`, so `req.user` is set. The first path segment after
 * the mount is the uid the worker wrote the asset under, and it has to match the
 * caller - there is no other way to know whose video this is, because a job id is
 * not a secret.
 */
function ownRenderAsset(req: Request, _res: Response, next: NextFunction): void {
  const uid = req.user?.uid;
  if (uid === undefined) {
    next(new UnauthorizedError('Missing Bearer token in the Authorization header.'));
    return;
  }

  const relative = req.path.replace(/^\/+/, '');
  const owner = relative.split('/')[0] ?? '';
  if (owner !== uid) {
    // 404 rather than 403: an asset that is not yours does not exist as far as
    // you are concerned, and confirming it does leaks its job id.
    next(new NotFoundError('That render asset does not exist.'));
    return;
  }

  next();
}

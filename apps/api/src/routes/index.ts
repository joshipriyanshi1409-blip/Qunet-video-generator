import type { Router as ExpressRouter } from 'express';
import { Router } from 'express';
import type { AuthOptions } from '../middleware/auth.js';
import type { DnaService } from '../services/dna.service.js';
import type { PingJobService } from '../services/pingJob.service.js';
import type { TrendService } from '../services/trend.service.js';
import type { AudienceService } from '../services/audience.service.js';
import type { VoiceCoachService } from '../voiceCoach/service.js';
import type { RenderJobService } from '../services/renderJob.service.js';
import type { DnaLearningService } from '../services/dnaLearning.service.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { ScriptCriticService } from '../services/scriptCritic.service.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import type { Logger } from 'pino';
import { createDnaRouter } from './dna.routes.js';
import { createJobsRouter } from './jobs.routes.js';
import { createMeRouter } from './me.routes.js';
import { createTrendRouter } from './trend.routes.js';
import { createAudienceRouter } from './audience.routes.js';
import { createVoiceCoachRouter } from './voiceCoach.routes.js';
import { createRenderRouter } from './render.routes.js';
import { createDnaLearningRouter } from './dnaLearning.routes.js';
import { createProjectRouter } from './project.routes.js';

/**
 * Everything under the API prefix. Versioning lives in the prefix itself
 * (`/api/v1`) so a future `/api/v2` can coexist.
 *
 * `dnaService`, `trendService` and `audienceService` are optional so the app can
 * be built without those stores (tests, and any deployment that has not migrated
 * yet). The audience router additionally needs the render job service, because
 * approving a project is what enqueues the render.
 */
export interface ApiRouterOptions {
  auth: AuthOptions;
  arenaRouter?: ExpressRouter;
  pingJobService: PingJobService;
  renderJobService?: RenderJobService;
  dnaService?: DnaService;
  trendService?: TrendService;
  audienceService?: AudienceService;
  /** Live Voice Coach. Omit to run without the coach entirely. */
  voiceCoachService?: VoiceCoachService;
  /** The learning loop. Omit to run without it (tests, minimal deployments). */
  dnaLearningService?: DnaLearningService;
  /** AI orchestrator for the full video creation pipeline. */
  orchestrator?: Orchestrator;
  /** Script critic for evaluating generated scripts. */
  scriptCritic?: ScriptCriticService;
  /** DNA repository for the project router. */
  dnaRepository?: DnaRepository;
  /** Logger for the project router. */
  logger?: Logger;
  /** Per-window limit for the model-backed trend endpoints. */
  aiRateLimit?: number;
  aiRateLimitWindowMs?: number;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const { auth, pingJobService } = options;
  const router = Router();

  router.use('/me', createMeRouter(auth));
  if (options.arenaRouter) router.use('/arena', options.arenaRouter);
  router.use('/jobs', createJobsRouter(auth, pingJobService, options.renderJobService));
  if (options.dnaService !== undefined) {
    router.use('/dna', createDnaRouter(auth, options.dnaService));
  }
  if (options.dnaLearningService !== undefined) {
    router.use(
      '/dna',
      createDnaLearningRouter({
        auth,
        service: options.dnaLearningService,
        aiLimit: options.aiRateLimit ?? 20,
        aiWindowMs: options.aiRateLimitWindowMs ?? 60_000,
      }),
    );
  }
  if (options.trendService !== undefined) {
    router.use(
      '/trends',
      createTrendRouter({
        auth,
        service: options.trendService,
        aiLimit: options.aiRateLimit ?? 20,
        aiWindowMs: options.aiRateLimitWindowMs ?? 60_000,
      }),
    );
  }
  if (options.voiceCoachService !== undefined) {
    router.use('/voice-coach', createVoiceCoachRouter({ auth, service: options.voiceCoachService }));
  }
  if (options.renderJobService !== undefined) {
    router.use('/render', createRenderRouter({ auth, service: options.renderJobService }));
  }
  if (options.audienceService !== undefined && options.renderJobService !== undefined) {
    router.use(
      createAudienceRouter({
        auth,
        service: options.audienceService,
        renderJobs: options.renderJobService,
        aiLimit: options.aiRateLimit ?? 20,
        aiWindowMs: options.aiRateLimitWindowMs ?? 60_000,
      }),
    );
  }
  // Project routes: orchestrator + script critic + DNA repository
  if (options.orchestrator !== undefined && options.scriptCritic !== undefined && options.dnaRepository !== undefined && options.logger !== undefined) {
    router.use(
      '/projects',
      createProjectRouter({
        auth,
        orchestrator: options.orchestrator,
        scriptCritic: options.scriptCritic,
        dnaRepository: options.dnaRepository,
        logger: options.logger,
      }),
    );
  }

  return router;
}

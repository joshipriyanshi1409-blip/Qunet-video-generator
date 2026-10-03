import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthOptions } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { ScriptCriticService } from '../services/scriptCritic.service.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import type { Logger } from 'pino';

/**
 * Project API routes.
 *
 * Provides the backend for the Create page's multi-step flow:
 * - POST /projects — create a new project (loads DNA, recommends formats)
 * - GET /projects/:id — get project state
 * - POST /projects/:id/recommend-formats — get AI format recommendations
 * - POST /projects/:id/select-format — select a content format
 * - POST /projects/:id/critique-script — run the script critic
 */

export interface ProjectRouterOptions {
  auth: AuthOptions;
  orchestrator: Orchestrator;
  scriptCritic: ScriptCriticService;
  dnaRepository: DnaRepository;
  logger: Logger;
}

const createProjectSchema = z.object({
  topic: z.string().trim().min(1).max(1000),
  contentFormatId: z.string().trim().min(1).max(40).optional(),
  trendId: z.string().trim().min(1).max(100).optional(),
});

const selectFormatSchema = z.object({
  formatId: z.string().trim().min(1).max(40),
});

const recommendFormatsSchema = z.object({
  topic: z.string().trim().min(1).max(1000),
});

const critiqueScriptSchema = z.object({
  hook: z.string().trim().min(1).max(300),
  scenes: z.array(z.object({
    scene: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(4000),
  })).min(1).max(12),
  cta: z.string().trim().min(1).max(300),
});

const projectIdParams = z.object({
  projectId: z.string().trim().min(1).max(128),
});

export function createProjectRouter(options: ProjectRouterOptions): Router {
  const { auth, orchestrator, scriptCritic, logger } = options;
  const router = Router();

  /** Create a new project — loads DNA, auto-recommends formats. */
  router.post(
    '/',
    requireAuth(auth),
    validate({ body: createProjectSchema }),
    async (req, res, next) => {
      try {
        const user = req.user;
        if (user === undefined) throw new UnauthorizedError();
        const uid = user.uid;
        const { topic, contentFormatId, trendId } = req.body as z.infer<typeof createProjectSchema>;

        const context = await orchestrator.createProject({
          userId: uid,
          topic,
          contentFormatId,
          trendId,
        });

        // Generate format recommendations
        const recommendations = await orchestrator.recommendFormats(context, topic);

        logger.info(
          { projectId: context.projectId, uid, topic: topic.slice(0, 60) },
          'project created via API',
        );

        res.status(201).json({
          projectId: context.projectId,
          topic: context.topic,
          contentFormat: context.contentFormat ? {
            id: context.contentFormat.id,
            name: context.contentFormat.name,
            description: context.contentFormat.description,
          } : null,
          recommendations: recommendations.recommendations,
          analysis: recommendations.analysis,
          hasDna: context.creatorDNA !== null,
          stage: context.currentStage,
          progress: context.progress,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** Get project state. */
  router.get(
    '/:projectId',
    requireAuth(auth),
    validate({ params: projectIdParams }),
    (req, res, next) => {
      try {
        const user = req.user;
        if (user === undefined) throw new UnauthorizedError();

        const projectId = req.params.projectId;
        if (typeof projectId !== 'string') throw new UnauthorizedError();

        const context = orchestrator.getContext(projectId);

        if (context === null || context.userId !== user.uid) {
          res.status(404).json({ error: { code: 'not_found', message: 'Project not found.' } });
          return;
        }

        res.json({
          projectId: context.projectId,
          topic: context.topic,
          contentFormat: context.contentFormat ? {
            id: context.contentFormat.id,
            name: context.contentFormat.name,
          } : null,
          hooks: context.hooks,
          selectedHook: context.selectedHook,
          script: context.script,
          scriptEvaluation: context.scriptEvaluation,
          stage: context.currentStage,
          progress: context.progress,
          completedStages: context.completedStages,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** Get AI format recommendations for a topic. */
  router.post(
    '/:projectId/recommend-formats',
    requireAuth(auth),
    validate({ params: projectIdParams, body: recommendFormatsSchema }),
    async (req, res, next) => {
      try {
        const user = req.user;
        if (user === undefined) throw new UnauthorizedError();

        const projectId = req.params.projectId;
        if (typeof projectId !== 'string') throw new UnauthorizedError();

        const context = orchestrator.getContext(projectId);

        if (context === null || context.userId !== user.uid) {
          res.status(404).json({ error: { code: 'not_found', message: 'Project not found.' } });
          return;
        }

        const body = req.body as z.infer<typeof recommendFormatsSchema>;
        const recommendations = await orchestrator.recommendFormats(context, body.topic);

        res.json(recommendations);
      } catch (error) {
        next(error);
      }
    },
  );

  /** Select a content format for the project. */
  router.post(
    '/:projectId/select-format',
    requireAuth(auth),
    validate({ params: projectIdParams, body: selectFormatSchema }),
    (req, res, next) => {
      try {
        const user = req.user;
        if (user === undefined) throw new UnauthorizedError();

        const projectId = req.params.projectId;
        if (typeof projectId !== 'string') throw new UnauthorizedError();

        const context = orchestrator.getContext(projectId);

        if (context === null || context.userId !== user.uid) {
          res.status(404).json({ error: { code: 'not_found', message: 'Project not found.' } });
          return;
        }

        const body = req.body as z.infer<typeof selectFormatSchema>;
        orchestrator.selectFormat(context, body.formatId);

        res.json({
          contentFormat: context.contentFormat ? {
            id: context.contentFormat.id,
            name: context.contentFormat.name,
            description: context.contentFormat.description,
            pacing: context.contentFormat.pacing,
            visualStyle: context.contentFormat.visualStyle,
            structure: context.contentFormat.structure,
            recommendedDuration: context.contentFormat.recommendedDuration,
          } : null,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /** Run the script critic on the project's script. */
  router.post(
    '/:projectId/critique-script',
    requireAuth(auth),
    validate({ params: projectIdParams, body: critiqueScriptSchema }),
    async (req, res, next) => {
      try {
        const user = req.user;
        if (user === undefined) throw new UnauthorizedError();

        const projectId = req.params.projectId;
        if (typeof projectId !== 'string') throw new UnauthorizedError();

        const context = orchestrator.getContext(projectId);

        if (context === null || context.userId !== user.uid) {
          res.status(404).json({ error: { code: 'not_found', message: 'Project not found.' } });
          return;
        }

        const body = req.body as z.infer<typeof critiqueScriptSchema>;

        const evaluation = await scriptCritic.evaluate({
          script: {
            hook: body.hook,
            scenes: body.scenes,
            cta: body.cta,
          },
          format: context.contentFormat,
          dna: context.creatorDNA,
        });

        // Store the evaluation and script on the context
        orchestrator.updateContext(projectId, {
          script: {
            hook: body.hook,
            scenes: body.scenes,
            cta: body.cta,
          },
          scriptEvaluation: evaluation,
        });

        res.json({
          evaluation,
          verdict: evaluation.verdict,
          overallScore: evaluation.overallScore,
          feedback: evaluation.feedback,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

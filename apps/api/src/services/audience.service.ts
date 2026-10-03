import {
  audienceMirrorRequestSchema,
  audienceMirrorResultSchema,
  improveRequestSchema,
  projectSchema,
  renderJobPayloadSchema,
  type AudienceMirrorRequest,
  type AudienceMirrorResult,
  type CreatorDna,
  type ImproveRequest,
  type Project,
  type RenderJobPayload,
  type ProjectVersion,
} from '@creatordna/shared';
import {
  formatFeedbackBlock,
  formatSegmentsBlock,
  improvedCopySchema,
  prompts,
} from '@creatordna/prompts';
import type { Logger } from 'pino';
import { NotFoundError } from '../lib/errors.js';
import type { ProjectRepository } from '../lib/projectRepository.js';
import { newProjectId } from '../lib/projectRepository.js';
import type { DnaService } from './dna.service.js';
import type { RenderJobService } from './renderJob.service.js';
import type { TextModelService } from './ai/index.js';

/**
 * Audience Mirror + the improve/approve loop.
 *
 * The mirror is a model call, but the loop around it is deliberately boring and
 * deterministic: every iteration is appended to the project's `versions` array,
 * so a revise loop is a sequence of records rather than a mutated blob. That is
 * what makes "what did I change, and why" answerable later.
 */

export interface AudienceServiceDeps {
  repository: ProjectRepository;
  dna: DnaService;
  ai: TextModelService;
  logger: Logger;
}

export interface AudienceService {
  /** Mirror one piece of content, creating or extending the project. */
  mirror(uid: string, request: AudienceMirrorRequest): Promise<{ project: Project; mirror: AudienceMirrorResult }>;
  /** Rewrite the hook or the CTA from the mirror's feedback. */
  improve(uid: string, request: ImproveRequest): Promise<{
    project: Project;
    target: ImproveRequest['target'];
    improved: { hook: string; cta: string };
    mirror?: AudienceMirrorResult;
  }>;
  /** Read one project, for resuming a loop after a reload. */
  get(projectId: string, uid: string): Promise<Project>;
  /**
   * Approve the newest version and create the render job.
   *
   * The payload is the approved script, so the job carries exactly what the
   * creator approved rather than whatever the project happens to hold now.
   */
  approve(
    uid: string,
    projectId: string,
    payload: RenderJobPayload,
    renderJobs: RenderJobService,
  ): Promise<{ project: Project; job: { jobId: string; queue: string; state: string } }>;
}

/**
 * The DNA as prompt variables.
 *
 * The registry rejects a variable the template never interpolates, so each
 * prompt gets exactly the block its own `variables[]` declares - not one shared
 * map that happens to be a superset.
 */
function dnaVariables(dna: CreatorDna): Record<string, string> {
  return {
    dna_niche: dna.niche,
    dna_tone: dna.tone.join(', '),
    dna_audience: dna.audience.join(', '),
    dna_audience_age: dna.audienceAgeRange ?? 'unknown',
    dna_audience_type: dna.audienceType ?? 'unknown',
    dna_style: dna.style,
    dna_personality: dna.personality.join(', '),
    dna_vocabulary: dna.vocabulary.length > 0 ? dna.vocabulary.join(', ') : 'none recorded',
    dna_catchphrases: dna.catchphrases.length > 0 ? dna.catchphrases.join(', ') : 'none recorded',
    dna_dos: dna.dos.length > 0 ? dna.dos.join(', ') : 'none recorded',
    dna_donts: dna.donts.length > 0 ? dna.donts.join(', ') : 'none recorded',
  };
}

/** `improve-copy` judges the hook and CTA only, so it needs fewer fields. */
function improveVariables(dna: CreatorDna): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dnaVariables(dna)).filter(([name]) => !name.startsWith('dna_audience_')),
  );
}

/** Runs the mirror prompt. Kept separate so `/improve` can re-check with it. */
async function runMirror(
  deps: Pick<AudienceServiceDeps, 'ai' | 'logger'>,
  uid: string,
  dna: CreatorDna,
  input: { content: string; hook: string; cta: string; segments: readonly string[] },
): Promise<AudienceMirrorResult> {
  const template = prompts.get('audience-mirror');

  const result = await deps.ai.callJson<AudienceMirrorResult>(
    prompts.render('audience-mirror', {
      content: input.content,
      hook: input.hook,
      cta: input.cta,
      ...dnaVariables(dna),
      segments_block: formatSegmentsBlock(input.segments),
    }),
    {
      schema: audienceMirrorResultSchema,
      promptId: template.id,
      promptVersion: template.version,
      uid,
      operation: 'audience-mirror',
      repromptHint:
        'Remember: judge EVERY segment you were given, in order, with interest exactly High, Medium or Low, and always fill overallInsight and improvedCta.',
    },
  );

  return audienceMirrorResultSchema.parse(result.data);
}

/** Appends a version and stamps the timestamps in one place. */
function appendVersion(project: Project, version: Omit<ProjectVersion, 'version' | 'createdAt'>): Project {
  const now = new Date().toISOString();
  const last = project.versions.at(-1);
  const next: ProjectVersion = {
    ...version,
    version: (last?.version ?? 0) + 1,
    createdAt: now,
  };

  return projectSchema.parse({
    ...project,
    versions: [...project.versions, next],
    updatedAt: now,
  });
}

export function createAudienceService(deps: AudienceServiceDeps): AudienceService {
  const { repository, dna, ai, logger } = deps;

  async function requireDna(uid: string): Promise<CreatorDna> {
    try {
      const profile = await dna.getProfile(uid);
      return profile.dna;
    } catch (error) {
      logger.debug({ uid, err: error }, 'audience request without a DNA profile');
      throw new NotFoundError(
        'No Creator DNA yet - finish onboarding first, then the mirror can judge your audience.',
      );
    }
  }

  return {
    async mirror(uid, request) {
      const validated = audienceMirrorRequestSchema.parse(request);
      const profile = await requireDna(uid);

      // An explicit segment list wins for this test only; otherwise the DNA's own.
      const segments = validated.segments ?? profile.audience;

      // Resolve or create the project. A caller that already has one gets its
      // history extended; a caller arriving straight from a remix gets a new one.
      let project: Project;
      if (validated.projectId === undefined) {
        const now = new Date().toISOString();
        project = await repository.create(
          projectSchema.parse({
            id: newProjectId(),
            uid,
            idea: validated.content,
            trendId: validated.trendId ?? null,
            status: 'awaiting-approval',
            versions: [],
            createdAt: now,
            updatedAt: now,
          }),
        );
      } else {
        const existing = await repository.get(validated.projectId, uid);
        if (existing === null) {
          throw new NotFoundError(`No project with id "${validated.projectId}".`);
        }
        project = existing;
      }

      const mirror = await runMirror({ ai, logger }, uid, profile, {
        content: validated.content,
        hook: validated.hook,
        cta: validated.cta,
        segments,
      });

      const withVersion = appendVersion(project, {
        kind: 'mirror',
        hook: validated.hook,
        cta: validated.cta,
        content: validated.content,
        mirror,
        feedback: [],
      });

      const saved = await repository.save(withVersion);

      logger.info(
        {
          uid,
          projectId: saved.id,
          version: saved.versions.at(-1)?.version,
          segments: segments.length,
          created: validated.projectId === undefined,
        },
        'audience mirror complete',
      );

      return { project: saved, mirror };
    },

    async improve(uid, request) {
      const validated = improveRequestSchema.parse(request);
      const profile = await requireDna(uid);

      const existing = await repository.get(validated.projectId, uid);
      if (existing === null) {
        throw new NotFoundError(`No project with id "${validated.projectId}".`);
      }

      // Improve always acts on the newest version: that is what the creator is
      // looking at, and re-editing an old one would silently discard the loop.
      const latest = existing.versions.at(-1);
      if (latest === undefined) {
        throw new NotFoundError(
          `Project "${validated.projectId}" has no versions yet - mirror it first.`,
        );
      }

      const template = prompts.get('improve-copy');
      const result = await ai.callJson<typeof improvedCopySchema._output>(
        prompts.render('improve-copy', {
          target: validated.target,
          hook: latest.hook,
          cta: latest.cta,
          feedback_block: formatFeedbackBlock(validated.feedback),
          ...improveVariables(profile),
        }),
        {
          schema: improvedCopySchema,
          promptId: template.id,
          promptVersion: template.version,
          uid,
          operation: 'improve-copy',
          repromptHint:
            'Remember: return hook, cta and changedWhat, keep the creator tone, and change only what the feedback asks for.',
        },
      );

      // The model rewrites both lines; only the requested one replaces the
      // stored copy, so an "improve the CTA" cannot quietly change the hook.
      const improved = {
        hook: validated.target === 'hook' ? result.data.hook : latest.hook,
        cta: validated.target === 'cta' ? result.data.cta : latest.cta,
      };

      let withVersion = appendVersion(existing, {
        kind: 'improve',
        hook: improved.hook,
        cta: improved.cta,
        content: improved.hook,
        improvedCta: validated.target === 'cta' ? improved.cta : latest.improvedCta,
        feedback: validated.feedback,
      });

      // Re-running the mirror is what makes the loop visible: the creator sees
      // the segment move rather than being asked to trust that it did.
      let mirror: AudienceMirrorResult | undefined;
      if (validated.recheck) {
        mirror = await runMirror({ ai, logger }, uid, profile, {
          content: improved.hook,
          hook: improved.hook,
          cta: improved.cta,
          segments: latest.mirror?.predictions.map((prediction) => prediction.segmentName) ??
            profile.audience,
        });

        withVersion = appendVersion(withVersion, {
          kind: 'mirror',
          hook: improved.hook,
          cta: improved.cta,
          content: improved.hook,
          mirror,
          feedback: validated.feedback,
        });
      }

      const saved = await repository.save(withVersion);

      logger.info(
        {
          uid,
          projectId: saved.id,
          target: validated.target,
          rechecked: validated.recheck,
          versions: saved.versions.length,
        },
        'copy improved',
      );

      return { project: saved, target: validated.target, improved, mirror };
    },

    async get(projectId, uid) {
      const project = await repository.get(projectId, uid);
      if (project === null) {
        throw new NotFoundError(`No project with id "${projectId}".`);
      }
      return project;
    },

    async approve(uid, projectId, payload, renderJobs) {
      const existing = await repository.get(projectId, uid);
      if (existing === null) {
        throw new NotFoundError(`No project with id "${projectId}".`);
      }

      const validated = renderJobPayloadSchema.parse(payload);
      const latest = existing.versions.at(-1);
      if (latest === undefined) {
        throw new NotFoundError(
          `Project "${projectId}" has no versions yet - mirror it before approving.`,
        );
      }

      const job = await renderJobs.create(validated, uid);

      const now = new Date().toISOString();
      const approved = projectSchema.parse({
        ...existing,
        status: 'rendering',
        approvedVersion: latest.version,
        renderJobId: job.jobId,
        updatedAt: now,
      });

      const saved = await repository.save(approved);

      logger.info(
        {
          uid,
          projectId: saved.id,
          approvedVersion: saved.approvedVersion,
          renderJobId: job.jobId,
        },
        'project approved and queued for render',
      );

      return { project: saved, job };
    },
  };
}

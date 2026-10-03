import {
  buildDnaContext,
  computeDnaSyncScore,
  creatorDnaSchema,
  dnaOnboardingInputSchema,
  dnaUpdateRequestSchema,
  type CreatorDna,
  type DnaContext,
  type DnaExtractionResponse,
  type DnaOnboardingInput,
  type DnaProfileResponse,
  type DnaUpdateRequest,
} from '@creatordna/shared';
import { formatSamplePostsBlock, prompts } from '@creatordna/prompts';
import type { Logger } from 'pino';
import { NotFoundError } from '../lib/errors.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import type { TextModelService } from '../services/ai/index.js';
import { AiValidationError } from '../services/ai/index.js';

/**
 * Creator DNA service: extraction, read/update, and the context block every
 * future prompt is prefixed with.
 */

export interface DnaServiceDeps {
  repository: DnaRepository;
  ai: TextModelService;
  logger: Logger;
  /** How many recent items to fold into the injected context. */
  historyLimit: number;
}

export interface DnaService {
  extract(uid: string, input: DnaOnboardingInput): Promise<DnaExtractionResponse>;
  getProfile(uid: string): Promise<DnaProfileResponse>;
  update(uid: string, patch: DnaUpdateRequest): Promise<DnaProfileResponse>;
  buildContext(uid: string): Promise<DnaContext>;
}

/** Fields that actually change what the model writes. */
function dnaContent(dna: CreatorDna): string {
  const { dnaVersion: _version, updatedAt: _updatedAt, ...rest } = dna;
  return JSON.stringify(rest);
}

/**
 * A new `dnaVersion` only when the *content* changed. Re-saving an identical
 * profile must not look like an edit, or the audit trail becomes noise.
 */
function nextVersion(existing: CreatorDna | null, incoming: CreatorDna): number {
  if (existing === null) return 1;
  return dnaContent(existing) === dnaContent(incoming) ? existing.dnaVersion : existing.dnaVersion + 1;
}

export function createDnaService(deps: DnaServiceDeps): DnaService {
  const { repository, ai, logger, historyLimit } = deps;

  async function profileResponse(uid: string, dna: CreatorDna): Promise<DnaProfileResponse> {
    const history = await repository.listHistory(uid, historyLimit);
    const context = buildDnaContext({ uid, dna, history, maxHistoryItems: historyLimit });

    return {
      dna,
      score: computeDnaSyncScore(dna),
      context: context.text,
      contextTokens: context.tokens,
    };
  }

  return {
    async extract(uid, input) {
      const validated = dnaOnboardingInputSchema.parse(input);
      const template = prompts.get('dna-extract');

      const messages = prompts.render('dna-extract', {
        niche: validated.niche,
        audience_age_range: validated.audienceAgeRange,
        audience_type: validated.audienceType,
        audience_description: validated.audienceDescription ?? 'not given',
        tone: validated.tone.join(', '),
        format: validated.format,
        sample_posts_block: formatSamplePostsBlock(validated.samplePosts),
      });

      logger.info(
        {
          uid,
          promptId: template.id,
          promptVersion: template.version,
          samplePosts: validated.samplePosts.length,
        },
        'dna extraction started',
      );

      let result;
      try {
        result = await ai.callJson<CreatorDna>(messages, {
          schema: creatorDnaSchema,
          promptId: template.id,
          promptVersion: template.version,
          uid,
          operation: 'dna-extract',
          repromptHint:
            'Remember: "samplePosts" must echo the posts you were given, and every string must be short.',
        });
      } catch (error) {
        if (error instanceof AiValidationError) {
          logger.error({ uid, issues: error.issues }, 'dna extraction rejected');
        }
        throw error;
      }

      const extracted = result.data;

      // Onboarding answers always win over anything the model inferred, so the
      // profile can never contradict what the creator typed.
      const dna = creatorDnaSchema.parse({
        ...extracted,
        niche: validated.niche,
        audienceAgeRange: validated.audienceAgeRange,
        audienceType: validated.audienceType,
        format: validated.format,
        tone: validated.tone,
        audience: extracted.audience.length > 0 ? extracted.audience : [validated.audienceType],
        samplePosts:
          validated.samplePosts.length > 0 ? validated.samplePosts : extracted.samplePosts,
      });

      const existing = await repository.get(uid);
      const versioned = creatorDnaSchema.parse({ ...dna, dnaVersion: nextVersion(existing, dna) });

      await repository.save(uid, versioned);
      await repository.appendHistory(
        uid,
        'script',
        `DNA extracted from onboarding (${validated.samplePosts.length} sample post(s)).`,
      );

      logger.info(
        { uid, dnaVersion: versioned.dnaVersion, reprompted: result.reprompted },
        'dna extraction complete',
      );

      const profile = await profileResponse(uid, versioned);

      return {
        ...profile,
        promptId: template.id,
        promptVersion: template.version,
        reprompted: result.reprompted,
        usage: result.usage,
      };
    },

    async getProfile(uid) {
      const dna = await repository.get(uid);
      if (dna === null) {
        throw new NotFoundError('No Creator DNA yet - finish onboarding first.');
      }
      return profileResponse(uid, dna);
    },

    async update(uid, patch) {
      const existing = await repository.get(uid);
      if (existing === null) {
        throw new NotFoundError('No Creator DNA yet - finish onboarding first.');
      }

      const merged = dnaUpdateRequestSchema.parse({
        ...existing,
        ...patch,
        samplePosts: patch.samplePosts ?? existing.samplePosts,
      });

      // A partial edit can never drop a required field: start from what is stored.
      const next = creatorDnaSchema.parse({
        ...existing,
        ...merged,
        dnaVersion: existing.dnaVersion,
      });

      const versioned = creatorDnaSchema.parse({
        ...next,
        dnaVersion: nextVersion(existing, next),
      });

      await repository.save(uid, versioned);
      await repository.appendHistory(uid, 'feedback', 'DNA edited from the My DNA screen.');

      return profileResponse(uid, versioned);
    },

    async buildContext(uid) {
      const dna = await repository.get(uid);
      if (dna === null) {
        throw new NotFoundError('No Creator DNA yet - finish onboarding first.');
      }
      const history = await repository.listHistory(uid, historyLimit);
      return buildDnaContext({ uid, dna, history, maxHistoryItems: historyLimit });
    },
  };
}

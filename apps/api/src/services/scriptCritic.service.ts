/**
 * Script Critic Service
 *
 * Evaluates generated scripts against Creator DNA, content format, and quality
 * standards. Returns structured feedback for revision or approval.
 *
 * The critic is a separate AI call that reviews the script and provides:
 * - Overall verdict (APPROVE / REVISE)
 * - Scores for hook strength, pacing, DNA fit, format compliance
 * - Specific feedback for improvement
 *
 * This implements the "critic loop" pattern: generate → critique → revise → repeat
 * up to a maximum number of iterations (default: 3).
 */

import { z } from 'zod';
import type {
  ContentFormatRecipe,
  CreatorDna,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import type { TextModelService } from '../services/ai/index.js';

/** Script evaluation result. */
export interface ScriptEvaluation {
  verdict: 'APPROVE' | 'REVISE';
  overallScore: number; // 0-100
  hookStrength: number; // 0-100
  pacingScore: number; // 0-100
  dnaFit: number; // 0-100
  formatCompliance: number; // 0-100
  feedback: string[];
  revisionSuggestions?: string[];
}

/** Input for script evaluation. */
export interface ScriptCriticInput {
  script: {
    hook: string;
    scenes: Array<{ scene: string; text: string }>;
    cta: string;
  };
  format?: ContentFormatRecipe | null;
  dna?: CreatorDna | null;
}

/** Schema for the critic's AI response. */
const scriptCriticResponseSchema = z.object({
  verdict: z.enum(['APPROVE', 'REVISE']),
  overallScore: z.number().min(0).max(100),
  hookStrength: z.number().min(0).max(100),
  pacingScore: z.number().min(0).max(100),
  dnaFit: z.number().min(0).max(100),
  formatCompliance: z.number().min(0).max(100),
  feedback: z.array(z.string()).min(1),
  revisionSuggestions: z.array(z.string()).optional(),
});

export interface ScriptCriticServiceDeps {
  ai: TextModelService;
  logger: Logger;
}

export interface ScriptCriticService {
  evaluate(input: ScriptCriticInput): Promise<ScriptEvaluation>;
}

export function createScriptCriticService(
  deps: ScriptCriticServiceDeps,
): ScriptCriticService {
  const { ai, logger } = deps;

  return {
    async evaluate(input: ScriptCriticInput): Promise<ScriptEvaluation> {
      const { script, format, dna } = input;

      const systemPrompt = `You are a script quality critic for CreatorDNA Studio.

Your job is to evaluate short-form video scripts (15-60 seconds) for quality, 
engagement, and alignment with the creator's DNA and chosen content format.

Be rigorous but fair. A score of 70+ means the script is ready to render.
Below 70 means it needs revision.

Evaluation criteria:
- Hook Strength (0-100): Does the opening grab attention in the first 3 seconds?
- Pacing (0-100): Does the script flow naturally? Is it too rushed or too slow?
- DNA Fit (0-100): Does it match the creator's tone, style, and vocabulary?
- Format Compliance (0-100): Does it follow the chosen format's structure and style?
- Overall Score (0-100): Weighted average of the above.

Provide specific, actionable feedback. Don't just say "improve the hook" — 
explain what would make it stronger.

Return JSON with this exact structure:
{
  "verdict": "APPROVE" | "REVISE",
  "overallScore": number,
  "hookStrength": number,
  "pacingScore": number,
  "dnaFit": number,
  "formatCompliance": number,
  "feedback": string[],
  "revisionSuggestions": string[] // only if verdict is REVISE
}`;

      const formatContext = format
        ? `\n\nCHOSEN FORMAT: ${format.name}
- Description: ${format.description}
- Pacing: ${format.pacing}
- Structure: ${format.structure.map((s) => s.label).join(' → ')}
- Visual Style: ${format.visualStyle}
- Narration Style: ${format.narrationStyle}
- Scene Duration: ${format.sceneDuration.min}-${format.sceneDuration.max}s`
        : '\n\nNO SPECIFIC FORMAT CHOSEN';

      const dnaContext = dna
        ? `\n\nCREATOR DNA:
- Niche: ${dna.niche}
- Tone: ${dna.tone.join(', ')}
- Audience: ${dna.audience.join(', ')}
- Style: ${dna.style}
- Personality: ${dna.personality.join(', ')}
- Vocabulary: ${dna.vocabulary.join(', ')}
- Dos: ${dna.dos.join(', ')}
- Donts: ${dna.donts.join(', ')}`
        : '\n\nNO CREATOR DNA AVAILABLE';

      const scriptText = [
        `HOOK: ${script.hook}`,
        ...script.scenes.map((s, i) => `SCENE ${i + 1} (${s.scene}): ${s.text}`),
        `CTA: ${script.cta}`,
      ].join('\n\n');

      const userPrompt = `Evaluate this script:

${scriptText}
${formatContext}
${dnaContext}

Return your evaluation as JSON.`;

      logger.info(
        { hasFormat: !!format, hasDna: !!dna, sceneCount: script.scenes.length },
        'script critic evaluating script',
      );

      try {
        const result = await ai.callJson(
          { system: systemPrompt, user: userPrompt },
          {
            schema: scriptCriticResponseSchema,
            promptId: 'script-critic',
            promptVersion: 1,
            uid: 'script-critic',
            operation: 'script-critic-evaluate',
          },
        );

        const parsed = scriptCriticResponseSchema.parse(result.data);

        const evaluation: ScriptEvaluation = {
          verdict: parsed.verdict,
          overallScore: parsed.overallScore,
          hookStrength: parsed.hookStrength,
          pacingScore: parsed.pacingScore,
          dnaFit: parsed.dnaFit,
          formatCompliance: parsed.formatCompliance,
          feedback: parsed.feedback,
          revisionSuggestions: parsed.revisionSuggestions,
        };

        logger.info(
          {
            verdict: evaluation.verdict,
            overallScore: evaluation.overallScore,
            hookStrength: evaluation.hookStrength,
            pacingScore: evaluation.pacingScore,
            dnaFit: evaluation.dnaFit,
            formatCompliance: evaluation.formatCompliance,
          },
          'script critic evaluation complete',
        );

        return evaluation;
      } catch (error) {
        logger.error({ error }, 'script critic evaluation failed');
        throw error;
      }
    },
  };
}

/**
 * Runs the generate-critique-revise loop.
 *
 * Calls the generator, then the critic, then (if revision needed) calls the
 * generator again with the feedback, up to maxIterations times.
 */
export interface ScriptRevisionLoopDeps {
  generate: (feedback?: string[]) => Promise<ScriptCriticInput['script']>;
  critic: ScriptCriticService;
  logger: Logger;
}

export async function runScriptRevisionLoop(
  deps: ScriptRevisionLoopDeps,
  input: Omit<ScriptCriticInput, 'script'>,
  maxIterations = 3,
): Promise<{ script: ScriptCriticInput['script']; evaluation: ScriptEvaluation; iterations: number }> {
  const { generate, critic, logger } = deps;
  let iterations = 0;
  let feedback: string[] | undefined;

  while (iterations < maxIterations) {
    iterations++;
    logger.info({ iteration: iterations }, 'script revision loop iteration');

    const script = await generate(feedback);
    const evaluation = await critic.evaluate({ script, ...input });

    if (evaluation.verdict === 'APPROVE' || iterations >= maxIterations) {
      logger.info(
        { iterations, verdict: evaluation.verdict, overallScore: evaluation.overallScore },
        'script revision loop complete',
      );
      return { script, evaluation, iterations };
    }

    // Prepare feedback for next iteration
    feedback = [
      ...evaluation.feedback,
      ...(evaluation.revisionSuggestions ?? []),
    ];
  }

  // Should never reach here due to the while condition, but TypeScript needs it
  throw new Error('Script revision loop exceeded maximum iterations');
}

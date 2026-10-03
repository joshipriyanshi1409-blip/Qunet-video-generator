import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { createScriptCriticService, runScriptRevisionLoop } from '../services/scriptCritic.service.js';
import type { TextModelService } from '../services/ai/index.js';
import type { PromptMessages } from '../services/ai/wrapper.js';
import type { AiCallOptions, AiCallResult } from '../services/ai/index.js';

const logger = pino({ level: 'silent' });

function createMockAi(verdict: 'APPROVE' | 'REVISE' = 'APPROVE'): TextModelService {
  return {
    async callJson<T>(_messages: PromptMessages, _options: AiCallOptions): Promise<AiCallResult<T>> {
      const data = {
        verdict,
        overallScore: verdict === 'APPROVE' ? 85 : 45,
        hookStrength: verdict === 'APPROVE' ? 90 : 40,
        pacingScore: verdict === 'APPROVE' ? 80 : 50,
        dnaFit: verdict === 'APPROVE' ? 88 : 35,
        formatCompliance: verdict === 'APPROVE' ? 82 : 45,
        feedback: verdict === 'APPROVE'
          ? ['Strong hook, good pacing throughout']
          : ['Hook needs more impact', 'Pacing is uneven'],
        revisionSuggestions: verdict === 'REVISE'
          ? ['Start with a question', 'Shorten scene 2']
          : undefined,
      } as unknown as T;

      return {
        data,
        usage: {
          promptTokens: 500,
          completionTokens: 200,
          totalTokens: 700,
          model: 'test-model',
          usedFallback: false,
          durationMs: 100,
        },
        reprompted: false,
      };
    },
  };
}

describe('ScriptCriticService', () => {
  it('evaluates a script and returns an approval', async () => {
    const ai = createMockAi('APPROVE');
    const critic = createScriptCriticService({ ai, logger });

    const result = await critic.evaluate({
      script: {
        hook: 'AI agents are changing everything',
        scenes: [
          { scene: 'Hook', text: 'AI agents are changing everything about how we build software.' },
          { scene: 'Body', text: 'They can now write code, test it, and deploy it autonomously.' },
          { scene: 'CTA', text: 'Follow for more insights on the future of development.' },
        ],
        cta: 'Follow for more insights',
      },
    });

    expect(result.verdict).toBe('APPROVE');
    expect(result.overallScore).toBe(85);
    expect(result.hookStrength).toBe(90);
    expect(result.pacingScore).toBe(80);
    expect(result.dnaFit).toBe(88);
    expect(result.formatCompliance).toBe(82);
    expect(result.feedback).toHaveLength(1);
  });

  it('evaluates a script and returns a revision request', async () => {
    const ai = createMockAi('REVISE');
    const critic = createScriptCriticService({ ai, logger });

    const result = await critic.evaluate({
      script: {
        hook: 'This is a weak hook',
        scenes: [
          { scene: 'Hook', text: 'This is a weak hook that does not grab attention.' },
          { scene: 'Body', text: 'The body goes on too long without building tension.' },
        ],
        cta: 'Like and subscribe',
      },
    });

    expect(result.verdict).toBe('REVISE');
    expect(result.overallScore).toBe(45);
    expect(result.revisionSuggestions).toBeDefined();
    expect(result.revisionSuggestions).toHaveLength(2);
  });

  it('includes format and DNA context when provided', async () => {
    const callJsonSpy = vi.fn().mockImplementation(async <T>() => ({
      data: {
        verdict: 'APPROVE',
        overallScore: 80,
        hookStrength: 75,
        pacingScore: 85,
        dnaFit: 90,
        formatCompliance: 78,
        feedback: ['Good format compliance'],
      } as T,
      usage: { promptTokens: 600, completionTokens: 150, totalTokens: 750, model: 'test', usedFallback: false, durationMs: 50 },
      reprompted: false,
    }));

    const ai: TextModelService = { callJson: callJsonSpy as TextModelService['callJson'] };
    const critic = createScriptCriticService({ ai, logger });

    await critic.evaluate({
      script: {
        hook: 'Test hook',
        scenes: [{ scene: 'Hook', text: 'Test' }],
        cta: 'Follow',
      },
      format: {
        id: 'tech-explainers',
        name: 'Tech Explainers',
        category: 'technology',
        description: 'Educational tech content',
        recommendedDuration: { min: 25, max: 45, default: 35 },
        pacing: 'moderate',
        hookStyles: ['question', 'curiosity', 'promise'],
        structure: [{ label: 'Question', description: 'What we explain', weight: 1.5 }],
        visualStyle: 'animation',
        captionStyle: 'phrase',
        narrationStyle: 'educational',
        sceneDuration: { min: 5, max: 12, default: 8 },
        ctaStyles: ['save', 'follow'],
        loopStrategy: 'none',
        musicIntensity: 0.3,
        transitions: ['cut'],
        audienceTriggers: ['curiosity'],
      },
      dna: {
        niche: 'AI and technology',
        tone: ['educational'],
        audience: ['Developers'],
        style: 'Clear explanations',
        personality: ['curious'],
        format: 'b-roll-voiceover',
        vocabulary: [],
        catchphrases: [],
        dos: [],
        donts: [],
        samplePosts: [],
        audienceAgeRange: '25-34',
        audienceType: 'professionals',
        dnaVersion: 1,
      },
    });

    expect(callJsonSpy).toHaveBeenCalledOnce();
    const firstCall = callJsonSpy.mock.calls[0]!;
    expect(firstCall).toBeDefined();
    const userPrompt = (firstCall[0] as PromptMessages).user;
    expect(userPrompt).toContain('Tech Explainers');
    expect(userPrompt).toContain('AI and technology');
    expect(userPrompt).toContain('CHOSEN FORMAT');
    expect(userPrompt).toContain('CREATOR DNA');
  });
});

describe('runScriptRevisionLoop', () => {
  it('returns on first iteration when critic approves', async () => {
    const generate = vi.fn().mockResolvedValue({
      hook: 'Strong hook',
      scenes: [{ scene: 'Hook', text: 'Content' }],
      cta: 'Follow',
    });
    const critic = createScriptCriticService({ ai: createMockAi('APPROVE'), logger });

    const result = await runScriptRevisionLoop(
      { generate, critic, logger },
      {},
      3,
    );

    expect(result.iterations).toBe(1);
    expect(result.evaluation.verdict).toBe('APPROVE');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('revises up to maxIterations and returns the last result', async () => {
    let callCount = 0;
    const generate = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        hook: `Hook attempt ${callCount}`,
        scenes: [{ scene: 'Hook', text: `Content ${callCount}` }],
        cta: 'Follow',
      };
    });

    // Always returns REVISE
    const critic = createScriptCriticService({ ai: createMockAi('REVISE'), logger });

    const result = await runScriptRevisionLoop(
      { generate, critic, logger },
      {},
      3,
    );

    expect(result.iterations).toBe(3);
    expect(generate).toHaveBeenCalledTimes(3);
    // Second and third calls should have feedback
    const secondCall = generate.mock.calls[1];
    const thirdCall = generate.mock.calls[2];
    expect(secondCall?.[0]).toBeDefined();
    expect(thirdCall?.[0]).toBeDefined();
  });
});

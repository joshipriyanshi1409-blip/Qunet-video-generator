import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { createOrchestrator, createEmptyContext } from '../services/orchestrator.js';
import { createModelRouter } from '../services/ai/modelRouter.js';
import type { CreatorDna } from '@creatordna/shared';

const logger = pino({ level: 'silent' });

const mockDna: CreatorDna = {
  niche: 'AI and technology',
  tone: ['educational', 'engaging'],
  audience: ['Developers', 'Tech enthusiasts'],
  style: 'Clear explanations with real-world examples',
  personality: ['curious', 'analytical'],
  format: 'b-roll-voiceover',
  vocabulary: ['algorithm', 'model', 'pipeline'],
  catchphrases: [],
  dos: ['Use concrete examples'],
  donts: ['Avoid jargon without explanation'],
  samplePosts: [],
  audienceAgeRange: '25-34',
  audienceType: 'professionals',
  dnaVersion: 3,
};

describe('createEmptyContext', () => {
  it('creates a context with all fields initialized', () => {
    const context = createEmptyContext('proj-1', 'user-1', 'AI agents');
    expect(context.projectId).toBe('proj-1');
    expect(context.userId).toBe('user-1');
    expect(context.topic).toBe('AI agents');
    expect(context.currentStage).toBe('idle');
    expect(context.progress).toBe(0);
    expect(context.creatorDNA).toBeNull();
    expect(context.contentFormat).toBeNull();
    expect(context.hooks).toEqual([]);
    expect(context.script).toBeNull();
    expect(context.completedStages).toEqual([]);
    expect(context.error).toBeNull();
  });
});

describe('Orchestrator', () => {
  const mockGetDna = vi.fn().mockResolvedValue(mockDna);
  const modelRouter = createModelRouter({ logger });

  it('creates a project and loads DNA', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Explain AI agents',
    });

    expect(context.projectId).toBeTruthy();
    expect(context.creatorDNA).not.toBeNull();
    expect(context.creatorDNA?.niche).toBe('AI and technology');
    expect(mockGetDna).toHaveBeenCalledWith('user-1');
  });

  it('creates a project with a specific format', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Explain AI agents',
      contentFormatId: 'tech-explainers',
    });

    expect(context.contentFormat?.id).toBe('tech-explainers');
    expect(context.contentFormat?.name).toBe('Tech Explainers');
  });

  it('creates a project with a trend context', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Remix of trending topic',
      trendId: 'trend-123',
    });

    expect(context.trendContext).not.toBeNull();
    expect(context.trendContext?.trendId).toBe('trend-123');
  });

  it('recommends formats based on topic and DNA', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = createEmptyContext('proj-1', 'user-1', 'How to build AI agents');
    context.creatorDNA = mockDna;

    const recommendation = await orchestrator.recommendFormats(context, 'How to build AI agents');

    expect(recommendation.recommendations.length).toBe(3);
    expect(recommendation.analysis).toBeTruthy();

    // Tech-related topic should favor tech/education formats
    const topFormat = recommendation.recommendations[0];
    expect(topFormat).toBeDefined();
    expect(topFormat?.score).toBeGreaterThan(0);
    expect(topFormat?.score).toBeLessThanOrEqual(100);
  });

  it('selects a format by id', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = createEmptyContext('proj-1', 'user-1', 'test');
    orchestrator.selectFormat(context, 'mystery');

    expect(context.contentFormat?.id).toBe('mystery');
    expect(context.completedStages).toContain('selecting-format');
  });

  it('falls back to first format when id not found', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = createEmptyContext('proj-1', 'user-1', 'test');
    orchestrator.selectFormat(context, 'nonexistent-format');

    expect(context.contentFormat).not.toBeNull();
    expect(context.contentFormat?.id).toBe('brainrot'); // first in list
  });

  it('builds a render request from context', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = createEmptyContext('proj-1', 'user-1', 'AI agents');
    context.selectedHook = { id: 'h1', text: 'AI agents are changing everything', style: 'bold-claim' };
    context.script = {
      hook: 'AI agents are changing everything',
      scenes: [
        { scene: 'Hook', text: 'AI agents are changing everything' },
        { scene: 'Body', text: 'They can now write code, test it, and deploy it.' },
        { scene: 'CTA', text: 'Follow to learn more.' },
      ],
      cta: 'Follow to learn more',
      caption: 'The future of development is here.',
      hashtags: ['#ai', '#agents', '#development'],
    };
    context.creatorDNA = mockDna;

    const request = orchestrator.buildRenderRequest(context);

    expect(request).not.toBeNull();
    expect(request?.projectId).toBe('proj-1');
    expect(request?.hook).toBe('AI agents are changing everything');
    expect(request?.script).toHaveLength(3);
    expect(request?.cta).toBe('Follow to learn more');
    expect(request?.caption).toBe('The future of development is here.');
    expect(request?.hashtags).toEqual(['#ai', '#agents', '#development']);
    expect(request?.dnaVersion).toBe(3);
  });

  it('returns null render request when no script', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = createEmptyContext('proj-1', 'user-1', 'test');
    const request = orchestrator.buildRenderRequest(context);

    expect(request).toBeNull();
  });

  it('stores and retrieves context by project id', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Test topic',
    });

    const retrieved = orchestrator.getContext(context.projectId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.topic).toBe('Test topic');
  });

  it('returns null for unknown project id', () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    expect(orchestrator.getContext('unknown-id')).toBeNull();
  });

  it('updates context with partial patch', async () => {
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
    });

    const context = await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Original topic',
    });

    orchestrator.updateContext(context.projectId, { progress: 50, currentStage: 'generating-hooks' });

    const updated = orchestrator.getContext(context.projectId);
    expect(updated?.progress).toBe(50);
    expect(updated?.currentStage).toBe('generating-hooks');
  });

  it('continues without DNA when getDna fails', async () => {
    const failingGetDna = vi.fn().mockRejectedValue(new Error('Database error'));
    const orchestrator = createOrchestrator({
      logger,
      getDna: failingGetDna,
      modelRouter,
    });

    const context = await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Test without DNA',
    });

    // Should not throw, DNA should be null
    expect(context.creatorDNA).toBeNull();
  });

  it('emits progress events', async () => {
    const events: Array<{ stage: string; progress: number }> = [];
    const orchestrator = createOrchestrator({
      logger,
      getDna: mockGetDna,
      modelRouter,
      emitProgress: (event) => events.push({ stage: event.stage, progress: event.progress }),
    });

    await orchestrator.createProject({
      userId: 'user-1',
      topic: 'Test progress events',
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.stage === 'loading-dna')).toBe(true);
  });
});

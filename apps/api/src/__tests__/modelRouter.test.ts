import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { createModelRouter, type TextProvider } from '../services/ai/modelRouter.js';

const logger = pino({ level: 'silent' });

function createMockTextProvider(id: string, status: 'available' | 'not_configured' | 'error' = 'available'): TextProvider {
  return {
    id,
    name: `Mock ${id}`,
    capabilities: ['TEXT_GENERATION' as const, 'REASONING' as const],
    costTier: id.includes('cheap') ? 1 : id.includes('premium') ? 3 : 2,
    speedTier: id.includes('fast') ? 3 : id.includes('slow') ? 1 : 2,
    supports(capability) {
      return this.capabilities.includes(capability);
    },
    getStatus() {
      return status;
    },
    async healthCheck() {
      return status === 'available';
    },
    async generateText() {
      return {
        text: 'mock response',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: id },
      };
    },
  };
}

describe('ModelRouter', () => {
  it('returns empty providers when none registered', () => {
    const router = createModelRouter({ logger });
    expect(router.getProviders()).toEqual([]);
  });

  it('lists all registered providers', () => {
    const provider = createMockTextProvider('gemini');
    const router = createModelRouter({ logger, textProviders: [provider] });
    const providers = router.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe('gemini');
    expect(providers[0]?.capabilities).toContain('TEXT_GENERATION');
  });

  it('returns capability status', () => {
    const provider = createMockTextProvider('gemini');
    const router = createModelRouter({ logger, textProviders: [provider] });

    expect(router.getCapabilityStatus('TEXT_GENERATION')).toBe('available');
    expect(router.getCapabilityStatus('IMAGE_GENERATION')).toBe('not_configured');
  });

  it('returns not_configured when provider has wrong status', () => {
    const provider = createMockTextProvider('gemini', 'not_configured');
    const router = createModelRouter({ logger, textProviders: [provider] });

    expect(router.getCapabilityStatus('TEXT_GENERATION')).toBe('not_configured');
  });

  it('selects model with balanced priority', () => {
    const cheap = createMockTextProvider('cheap-model');
    const premium = createMockTextProvider('premium-model');
    const router = createModelRouter({ logger, textProviders: [cheap, premium] });

    const selected = router.selectModel({ capability: 'TEXT_GENERATION', priority: 'balanced' });
    expect(selected).not.toBeNull();
    // Balanced prefers tier 2
    expect(selected?.id).toBe('cheap-model'); // tier 1 is closer to 2 than tier 3
  });

  it('selects model with cost priority', () => {
    const cheap = createMockTextProvider('cheap-model');
    const premium = createMockTextProvider('premium-model');
    const router = createModelRouter({ logger, textProviders: [cheap, premium] });

    const selected = router.selectModel({ capability: 'TEXT_GENERATION', priority: 'cost' });
    expect(selected).not.toBeNull();
    expect(selected?.id).toBe('cheap-model');
  });

  it('selects model with quality priority', () => {
    const cheap = createMockTextProvider('cheap-model');
    const premium = createMockTextProvider('premium-model');
    const router = createModelRouter({ logger, textProviders: [cheap, premium] });

    const selected = router.selectModel({ capability: 'TEXT_GENERATION', priority: 'quality' });
    expect(selected).not.toBeNull();
    expect(selected?.id).toBe('premium-model');
  });

  it('prefers a specific provider when requested', () => {
    const cheap = createMockTextProvider('cheap-model');
    const premium = createMockTextProvider('premium-model');
    const router = createModelRouter({ logger, textProviders: [cheap, premium] });

    const selected = router.selectModel({
      capability: 'TEXT_GENERATION',
      preferredProvider: 'premium-model',
    });
    expect(selected?.id).toBe('premium-model');
  });

  it('returns null when no provider supports the capability', () => {
    const provider = createMockTextProvider('text-only');
    const router = createModelRouter({ logger, textProviders: [provider] });

    const selected = router.selectModel({ capability: 'IMAGE_GENERATION' });
    expect(selected).toBeNull();
  });

  it('returns null when no providers are available', () => {
    const provider = createMockTextProvider('gemini', 'error');
    const router = createModelRouter({ logger, textProviders: [provider] });

    const selected = router.selectModel({ capability: 'TEXT_GENERATION' });
    expect(selected).toBeNull();
  });

  it('gets text provider', () => {
    const provider = createMockTextProvider('gemini');
    const router = createModelRouter({ logger, textProviders: [provider] });

    const got = router.getTextProvider();
    expect(got).not.toBeNull();
    expect(got?.id).toBe('gemini');
  });

  it('returns null text provider when none available', () => {
    const router = createModelRouter({ logger });
    expect(router.getTextProvider()).toBeNull();
  });

  it('returns null image provider when none available', () => {
    const router = createModelRouter({ logger });
    expect(router.getImageProvider()).toBeNull();
  });

  it('returns null video provider when none available', () => {
    const router = createModelRouter({ logger });
    expect(router.getVideoProvider()).toBeNull();
  });

  it('returns null tts provider when none available', () => {
    const router = createModelRouter({ logger });
    expect(router.getTtsProvider()).toBeNull();
  });

  it('returns null music provider when none available', () => {
    const router = createModelRouter({ logger });
    expect(router.getMusicProvider()).toBeNull();
  });

  it('runs health checks', async () => {
    const healthy = createMockTextProvider('healthy', 'available');
    const unhealthy = createMockTextProvider('unhealthy', 'error');
    const router = createModelRouter({ logger, textProviders: [healthy, unhealthy] });

    const results = await router.healthCheck();
    expect(results['healthy']).toBe('available');
    expect(results['unhealthy']).toBe('error');
  });
});

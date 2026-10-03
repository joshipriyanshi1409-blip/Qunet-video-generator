import { describe, expect, it } from 'vitest';
import { PromptRegistry } from '../registry.js';
import { PromptNotFoundError, PromptVersionNotFoundError } from '../errors.js';
import type { PromptTemplate } from '../types.js';
import { trendRemixV1 } from '../templates/trend-remix.v1.js';
import { trendRemixSchema } from '@creatordna/shared';
import { prompts as rootRegistry } from '../index.js';

function makeTemplate(id: string, version: number, body = 'body'): PromptTemplate {
  return {
    id,
    version,
    description: `${id} v${version}`,
    variables: [{ name: 'who', description: 'Who to greet.' }],
    build: (variables) => ({ system: body, user: `hi {{who}}`.replace('{{who}}', variables.who ?? '') }),
  };
}

const dnaVariables = {
  dna_niche: 'DSA interview prep',
  dna_tone: 'direct, encouraging',
  dna_audience: 'Students, Working professionals',
  dna_audience_age: '25-34',
  dna_audience_type: 'professionals',
  dna_style: 'Whiteboard, fast cuts',
  dna_personality: 'blunt, patient',
  dna_format: 'whiteboard',
  dna_vocabulary: 'amortized, off-by-one',
  dna_catchphrases: 'Let that sink in',
  dna_dos: 'show the dry run',
  dna_donts: 'no jargon dumps',
};

const variables = {
  trend_format: 'POV: You finally {achievement}',
  trend_title: 'POV: You finally understand binary search',
  trend_description: 'Creator narrates the moment a concept clicks.',
  trend_category: 'education',
  ...dnaVariables,
  idea_block: 'None',
};

describe('PromptRegistry', () => {
  it('starts empty and is registered by id', () => {
    const registry = new PromptRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('returns the latest version when no version is requested', () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate('greet', 1, 'v1 system'));
    registry.register(makeTemplate('greet', 2, 'v2 system'));

    expect(registry.get('greet').version).toBe(2);
    expect(registry.get('greet', 1).version).toBe(1);
    expect(registry.latestVersion('greet')).toBe(2);
  });

  it('keeps old versions callable for rollback', () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate('greet', 1, 'v1 system'));
    registry.register(makeTemplate('greet', 2, 'v2 system'));

    expect(registry.render('greet', { who: 'Ada' }, 1).system).toBe('v1 system');
    expect(registry.render('greet', { who: 'Ada' }).system).toBe('v2 system');
  });

  it('throws for an unknown id and for an unknown version', () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate('greet', 1));

    expect(() => registry.get('nope')).toThrow(PromptNotFoundError);
    expect(() => registry.get('greet', 9)).toThrow(PromptVersionNotFoundError);
  });

  it('refuses to register the same id twice at the same version', () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate('greet', 1));
    expect(() => registry.register(makeTemplate('greet', 1))).toThrow(/already registered/);
  });

  it('lists descriptors sorted by id then version', () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate('greet', 2));
    registry.register(makeTemplate('greet', 1));
    registry.register(makeTemplate('audit', 1));

    expect(registry.list().map((descriptor) => `${descriptor.id}@${descriptor.version}`)).toEqual([
      'audit@1',
      'greet@1',
      'greet@2',
    ]);
  });

  it('clears registered templates (used by tests)', () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate('greet', 1));
    registry.clear();
    expect(registry.list()).toEqual([]);
  });
});

describe('the exported registry', () => {
  it('registers every template', () => {
    // `list()` is sorted by id, so this also documents the full catalogue.
    expect(rootRegistry.list().map((descriptor) => `${descriptor.id}@${descriptor.version}`)).toEqual([
      'audience-mirror@1',
      'dna-extract@1',
      'dna-learn@1',
      'hook-lab@1',
      'improve-copy@1',
      'storyboard@1',
      'trend-relevance@1',
      'trend-remix@1',
    ]);
    for (const descriptor of rootRegistry.list()) {
      expect(rootRegistry.latestVersion(descriptor.id)).toBe(descriptor.version);
    }
  });

  it('gives every registered template an output schema and variables', () => {
    for (const descriptor of rootRegistry.list()) {
      const template = rootRegistry.get(descriptor.id, descriptor.version);
      expect(template.outputSchema).toBeDefined();
      expect(template.variables.length).toBeGreaterThan(0);
    }
  });
});

describe('the registered trend remix template', () => {
  it('renders both messages with every DNA variable injected', () => {
    const registry = new PromptRegistry();
    registry.register(trendRemixV1);

    const { system, user } = registry.render('trend-remix', variables);

    expect(system).toContain('recognizable structure');
    expect(user).toContain('TREND FORMAT: POV: You finally {achievement}');
    expect(user).toContain('niche: DSA interview prep');
    expect(user).not.toContain('{{');
  });

  it('exposes the shared output schema the model response must satisfy', () => {
    expect(trendRemixV1.outputSchema).toBe(trendRemixSchema);

    const parsed = trendRemixV1.outputSchema?.parse({
      trendId: 'trend_pov_finally',
      format: 'POV: You finally {achievement}',
      hook: 'POV: You finally understand Binary Search after 3 days',
      script: [{ scene: 'Hook', text: 'POV: ...' }],
      cta: 'Follow for the next data structure',
      caption: 'Binary search finally clicked.',
      hashtags: ['#dsa'],
      whatWasKept: ['POV opening'],
      whatWasChanged: ['topic swapped to binary search'],
    });

    expect(parsed?.hook).toContain('Binary Search');
    expect(trendRemixV1.variables.length).toBeGreaterThan(10);
  });

  it('rejects a response with no audit trail', () => {
    const result = trendRemixV1.outputSchema?.safeParse({
      format: 'f',
      hook: 'h',
      script: [{ scene: 'Hook', text: 't' }],
      cta: 'c',
      caption: 'cap',
    });
    expect(result?.success).toBe(false);
  });
});

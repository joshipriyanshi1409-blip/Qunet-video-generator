import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_MAP,
  CONTENT_FORMAT_IDS,
  CONTENT_FORMAT_LABELS,
  CONTENT_FORMATS_BY_CATEGORY,
  contentFormatRecipeSchema,
  formatRecommendationSchema,
  formatSelectionSchema,
} from '../index.js';

describe('content format schema', () => {
  it('validates a correct format recipe', () => {
    const recipe = {
      id: 'test-format',
      name: 'Test Format',
      category: 'storytelling' as const,
      description: 'A test format for testing purposes',
      recommendedDuration: { min: 15, max: 45, default: 30 },
      pacing: 'moderate' as const,
      hookStyles: ['curiosity' as const, 'question' as const],
      structure: [
        { label: 'Hook', description: 'Opening hook', weight: 1.5 },
        { label: 'Body', description: 'Main content', weight: 3 },
        { label: 'CTA', description: 'Call to action', weight: 1 },
      ],
      visualStyle: 'cinematic' as const,
      captionStyle: 'phrase' as const,
      narrationStyle: 'storytelling' as const,
      sceneDuration: { min: 3, max: 10, default: 6 },
      ctaStyles: ['follow' as const, 'save' as const],
      loopStrategy: 'none' as const,
      musicIntensity: 0.4,
      transitions: ['cut', 'dissolve'],
      audienceTriggers: ['curiosity', 'engagement'],
    };

    const result = contentFormatRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
  });

  it('rejects a format with no structure steps', () => {
    const recipe = {
      id: 'test',
      name: 'Test',
      category: 'storytelling',
      description: 'A test format',
      recommendedDuration: { min: 15, max: 45, default: 30 },
      pacing: 'moderate',
      hookStyles: ['curiosity'],
      structure: [],
      visualStyle: 'cinematic',
      captionStyle: 'phrase',
      narrationStyle: 'storytelling',
      sceneDuration: { min: 3, max: 10, default: 6 },
      ctaStyles: ['follow'],
    };

    const result = contentFormatRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });
});

describe('content formats catalogue', () => {
  it('has exactly 50 formats', () => {
    expect(CONTENT_FORMATS.length).toBe(50);
  });

  it('every format has a unique id', () => {
    const ids = CONTENT_FORMATS.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every format validates against its own schema', () => {
    for (const format of CONTENT_FORMATS) {
      const result = contentFormatRecipeSchema.safeParse(format);
      expect(result.success).toBe(true);
    }
  });

  it('every format id is in CONTENT_FORMAT_IDS', () => {
    expect(CONTENT_FORMAT_IDS.length).toBe(50);
    for (const format of CONTENT_FORMATS) {
      expect(CONTENT_FORMAT_IDS).toContain(format.id);
    }
  });

  it('CONTENT_FORMAT_MAP has every format', () => {
    expect(CONTENT_FORMAT_MAP.size).toBe(50);
    for (const format of CONTENT_FORMATS) {
      expect(CONTENT_FORMAT_MAP.get(format.id)).toBe(format);
    }
  });

  it('CONTENT_FORMAT_LABELS has every format', () => {
    expect(Object.keys(CONTENT_FORMAT_LABELS).length).toBe(50);
    for (const format of CONTENT_FORMATS) {
      expect(CONTENT_FORMAT_LABELS[format.id]).toBe(format.name);
    }
  });

  it('every format has a non-empty structure', () => {
    for (const format of CONTENT_FORMATS) {
      expect(format.structure.length).toBeGreaterThanOrEqual(2);
      for (const step of format.structure) {
        expect(step.label.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(0);
        expect(step.weight).toBeGreaterThan(0);
      }
    }
  });

  it('every format has recommended duration within valid range', () => {
    for (const format of CONTENT_FORMATS) {
      expect(format.recommendedDuration.min).toBeGreaterThanOrEqual(15);
      expect(format.recommendedDuration.max).toBeLessThanOrEqual(120);
      expect(format.recommendedDuration.default).toBeGreaterThanOrEqual(format.recommendedDuration.min);
      expect(format.recommendedDuration.default).toBeLessThanOrEqual(format.recommendedDuration.max);
    }
  });

  it('every format has at least one hook style', () => {
    for (const format of CONTENT_FORMATS) {
      expect(format.hookStyles.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every format has at least one CTA style', () => {
    for (const format of CONTENT_FORMATS) {
      expect(format.ctaStyles.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('formats span all 8 categories', () => {
    const categories = new Set(CONTENT_FORMATS.map((f) => f.category));
    expect(categories.size).toBe(8);
    expect(categories).toContain('storytelling');
    expect(categories).toContain('education');
    expect(categories).toContain('entertainment');
    expect(categories).toContain('lifestyle');
    expect(categories).toContain('technology');
    expect(categories).toContain('business');
    expect(categories).toContain('creative');
    expect(categories).toContain('wellness');
  });

  it('formats are properly grouped by category', () => {
    const totalByCategory = Object.values(CONTENT_FORMATS_BY_CATEGORY).reduce(
      (sum, group) => sum + group.length,
      0,
    );
    expect(totalByCategory).toBe(50);
  });

  it('includes the specific formats from the spec', () => {
    const expectedFormats = [
      'brainrot',
      'pov',
      'storytime',
      'mystery',
      'dark-stories',
      'true-crime',
      'reddit-stories',
      'confession-stories',
      'relationship-stories',
      'aita-stories',
      'celebrity-stories',
      'rich-lifestyle',
      'success-stories',
      'transformation',
      'motivation',
      'self-improvement',
      'psychology',
      'interesting-facts',
      'did-you-know',
      'hidden-facts',
      'history',
      'history-mysteries',
      'science-facts',
      'space',
      'future-predictions',
      'ai-content',
      'tech-news',
      'tech-explainers',
      'money-finance',
      'business-stories',
      'startup-stories',
      'how-x-makes-money',
      'luxury-things',
      'food-content',
      'street-food',
      'travel',
      'hidden-places',
      'gaming',
      'gaming-lore',
      'fitness',
      'health-tips',
      'life-hacks',
      'tutorials',
      'product-discovery',
      'product-testing',
      'satisfying-videos',
      'asmr',
      'oddly-satisfying',
      'ai-visual-stories',
      'mini-documentaries',
    ];

    for (const id of expectedFormats) {
      expect(CONTENT_FORMAT_MAP.has(id), `missing format: ${id}`).toBe(true);
    }
  });
});

describe('format selection schema', () => {
  it('validates AI recommended mode', () => {
    const result = formatSelectionSchema.safeParse({
      mode: 'ai-recommended',
      recommendations: [
        { formatId: 'brainrot', score: 85, reason: 'Good fit' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates manual mode with format id', () => {
    const result = formatSelectionSchema.safeParse({
      mode: 'manual',
      formatId: 'mystery',
    });
    expect(result.success).toBe(true);
  });
});

describe('format recommendation schema', () => {
  it('validates a recommendation result', () => {
    const result = formatRecommendationSchema.safeParse({
      recommendations: [
        { formatId: 'mini-documentaries', formatName: 'Mini Documentaries', score: 92, reason: 'Perfect for deep-dives' },
        { formatId: 'ai-content', formatName: 'AI Content', score: 78, reason: 'Directly covers AI topics' },
        { formatId: 'tech-explainers', formatName: 'Tech Explainers', score: 71, reason: 'Good for explaining concepts' },
      ],
      analysis: 'Your topic is about AI agents which fits well with educational and technology formats.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty recommendations', () => {
    const result = formatRecommendationSchema.safeParse({
      recommendations: [],
      analysis: 'No formats found.',
    });
    expect(result.success).toBe(false);
  });
});

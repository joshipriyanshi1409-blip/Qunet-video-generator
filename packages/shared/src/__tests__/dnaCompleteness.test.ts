import { describe, expect, it } from 'vitest';
import { computeDnaCompleteness } from '../lib/dnaCompleteness.js';
import { creatorDnaUpsertSchema, type CreatorDnaUpsert } from '../schemas/dna.schema.js';

/**
 * `format` is an enum, so it is always "filled" - a profile with nothing else
 * scores its 10 points. Everything else must be non-empty to count.
 */
const emptyProfile: CreatorDnaUpsert = {
  niche: '',
  tone: [],
  audience: [],
  style: '',
  personality: [],
  format: 'other',
  vocabulary: [],
  catchphrases: [],
  dos: [],
  donts: [],
  samplePosts: [],
};

const fullProfile: CreatorDnaUpsert = {
  niche: 'DSA interview prep',
  tone: ['direct'],
  audience: ['Students'],
  style: 'Whiteboard, fast cuts',
  personality: ['blunt'],
  format: 'whiteboard',
  vocabulary: ['amortized'],
  catchphrases: ['Let that sink in'],
  dos: ['dry run'],
  donts: ['jargon'],
  samplePosts: [{ text: 'Binary search in 30s' }],
};

describe('computeDnaCompleteness', () => {
  it('returns only the format points and lists every missing field for an empty profile', () => {
    const result = computeDnaCompleteness(emptyProfile);
    expect(result.completeness).toBe(10);
    expect(result.missingFields).toEqual([
      'Niche',
      'Tone',
      'Audience',
      'Style',
      'Personality',
      'Vocabulary',
      'Catchphrases',
      'Dos',
      "Don'ts",
      'Sample posts',
    ]);
  });

  it('returns 100% and no missing fields for a complete profile', () => {
    const result = computeDnaCompleteness(fullProfile);
    expect(result.completeness).toBe(100);
    expect(result.missingFields).toEqual([]);
  });

  it('is weighted: niche + audience + style + format = 50%', () => {
    const result = computeDnaCompleteness({
      ...emptyProfile,
      niche: 'DSA',
      audience: ['Students'],
      style: 'Whiteboard',
      format: 'whiteboard',
    });
    expect(result.completeness).toBe(50);
    expect(result.missingFields).toContain('Tone');
  });

  it('ignores whitespace-only strings', () => {
    const result = computeDnaCompleteness({ ...emptyProfile, niche: '   ' });
    expect(result.completeness).toBe(10);
    expect(result.missingFields).toContain('Niche');
  });

  it('falls back to dnaVersion 1 when unset', () => {
    expect(computeDnaCompleteness(fullProfile).dnaVersion).toBe(1);
  });

  it('works on a parsed upsert payload', () => {
    const parsed = creatorDnaUpsertSchema.parse({
      niche: 'Cooking',
      tone: ['warm'],
      audience: ['Parents'],
      style: 'Overhead shots',
      personality: ['calm'],
      format: 'b-roll-voiceover',
    });
    // niche 15 + tone 10 + audience 15 + style 10 + personality 5 + format 10
    expect(computeDnaCompleteness(parsed).completeness).toBe(65);
  });
});

import { describe, expect, it } from 'vitest';
import { computeDnaConsistency, computeDnaSyncScore } from '../lib/dnaSyncScore.js';
import { creatorDnaUpsertSchema, type CreatorDnaUpsert } from '../schemas/dna.schema.js';

const base: CreatorDnaUpsert = {
  niche: 'DSA interview prep',
  tone: ['direct', 'practical'],
  audience: ['Students'],
  style: 'Whiteboard, fast cuts',
  personality: ['blunt'],
  format: 'whiteboard',
  vocabulary: ['amortized', 'Big-O'],
  catchphrases: ['Let that sink in'],
  dos: ['dry run'],
  donts: ['jargon'],
  samplePosts: [
    { text: 'Binary search is O(log n). Amortized analysis matters. Let that sink in.' },
    { text: 'Big-O is not scary. Dry run the loop before you commit.' },
  ],
};

describe('computeDnaConsistency', () => {
  it('is 100 when the evidence agrees with the declarations', () => {
    const result = computeDnaConsistency(base);
    expect(result.consistency).toBe(100);
    expect(result.inconsistencies).toEqual([]);
  });

  it('is 100 when there is nothing to contradict (no sample posts)', () => {
    // A brand-new creator has no evidence yet; consistency must not punish them.
    const result = computeDnaConsistency({ ...base, samplePosts: [] });
    expect(result.consistency).toBe(100);
    expect(result.inconsistencies).toEqual([]);
  });

  it('drops when declared vocabulary never appears in the samples', () => {
    const result = computeDnaConsistency({
      ...base,
      vocabulary: ['amortized', 'polymath', 'quixotic'],
      catchphrases: [],
    });
    expect(result.consistency).toBeLessThan(100);
    expect(result.inconsistencies.join(' ')).toContain('never appear in your sample posts');
  });

  it('does not require tone words to appear verbatim in the samples', () => {
    // "direct" is a descriptor a creator picks, not a word they type.
    const result = computeDnaConsistency({
      ...base,
      tone: ['direct', 'practical', 'wry'],
      vocabulary: [],
      catchphrases: [],
    });
    expect(result.consistency).toBe(100);
    expect(result.inconsistencies).toEqual([]);
  });

  it('loses at most 40 points for vocabulary that never shows up', () => {
    const result = computeDnaConsistency({
      ...base,
      vocabulary: ['amortized', 'polymath', 'quixotic', 'serendipity', 'ephemeral'],
      catchphrases: [],
    });
    // 4 of 5 words missing -> 80% of the 40-point cap.
    expect(result.consistency).toBe(68);
    expect(result.inconsistencies).toHaveLength(1);
  });

  it('flags a word that is both in the word list and in "do not"', () => {
    const result = computeDnaConsistency({
      ...base,
      donts: ['amortized'],
    });
    expect(result.consistency).toBe(85);
    expect(result.inconsistencies.join(' ')).toContain('do not');
  });

  it('flags a described audience left as "other"', () => {
    const result = computeDnaConsistency({
      ...base,
      audienceType: 'other',
    });
    expect(result.consistency).toBe(95);
    expect(result.inconsistencies.join(' ')).toContain('audience');
  });

  it('ignores case and punctuation when matching words', () => {
    const result = computeDnaConsistency({
      ...base,
      vocabulary: ['AMORTIZED', 'big o'],
      catchphrases: [],
    });
    expect(result.consistency).toBe(100);
  });

  it('never leaves the 0-100 range', () => {
    const result = computeDnaConsistency({
      ...base,
      vocabulary: ['zzz', 'qqq', 'www'],
      catchphrases: ['yyy'],
      tone: ['melancholy'],
      donts: ['zzz', 'qqq', 'www', 'yyy'],
      audienceType: 'other',
    });
    expect(result.consistency).toBeGreaterThanOrEqual(0);
    expect(result.consistency).toBeLessThanOrEqual(100);
  });
});

describe('computeDnaSyncScore', () => {
  it('blends completeness and consistency 70/30', () => {
    // A complete, consistent profile scores 100.
    const parsed = creatorDnaUpsertSchema.parse(base);
    expect(computeDnaSyncScore(parsed).score).toBe(100);
  });

  it('drops the score when the profile is incomplete', () => {
    const parsed = creatorDnaUpsertSchema.parse({
      niche: 'DSA',
      tone: ['direct'],
      audience: ['Students'],
      style: 'Whiteboard',
      personality: ['blunt'],
      format: 'whiteboard',
    });
    const result = computeDnaSyncScore(parsed);
    expect(result.completeness).toBe(65);
    expect(result.consistency).toBe(100);
    // 65 * 0.7 + 100 * 0.3 = 75.5 -> 76
    expect(result.score).toBe(76);
  });

  it('reports missing fields and inconsistencies separately', () => {
    const parsed = creatorDnaUpsertSchema.parse({
      ...base,
      donts: ['amortized'],
    });
    const result = computeDnaSyncScore(parsed);
    expect(result.missingFields).toEqual([]);
    expect(result.inconsistencies).toHaveLength(1);
    expect(result.score).toBeLessThan(100);
  });

  it('carries the dnaVersion through', () => {
    expect(computeDnaSyncScore({ ...base, dnaVersion: 7 }).dnaVersion).toBe(7);
    expect(computeDnaSyncScore(base).dnaVersion).toBe(1);
  });
});

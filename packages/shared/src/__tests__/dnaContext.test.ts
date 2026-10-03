import { describe, expect, it } from 'vitest';
import {
  buildDnaContext,
  DNA_CONTEXT_TOKEN_BUDGET,
  DNA_CONTEXT_HISTORY_LIMIT,
  estimateTokens,
  formatDnaBlock,
} from '../lib/dnaContext.js';
import { creatorDnaSchema, type DnaHistoryItem } from '../schemas/dna.schema.js';

const dna = creatorDnaSchema.parse({
  niche: 'DSA interview prep',
  tone: ['direct', 'practical'],
  audience: ['Students', 'Career switchers'],
  audienceAgeRange: '18-24',
  audienceType: 'students',
  style: 'Whiteboard, fast cuts, no fluff',
  personality: ['blunt', 'encouraging'],
  format: 'whiteboard',
  vocabulary: ['amortized', 'Big-O'],
  catchphrases: ['Let that sink in'],
  dos: ['dry run the code'],
  donts: ['jargon without explanation'],
  samplePosts: [{ text: 'Binary search in 30 seconds.' }],
});

function history(count: number): DnaHistoryItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `h${index}`,
    kind: 'script' as const,
    createdAt: '2026-10-02T10:00:00.000Z',
    summary: `Script number ${index} about graphs and trees.`,
  }));
}

describe('estimateTokens', () => {
  it('uses the ~4 characters per token rule of thumb', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(401))).toBe(101);
  });
});

describe('formatDnaBlock', () => {
  it('includes every field that shapes a prompt', () => {
    const block = formatDnaBlock(dna);
    expect(block).toContain('niche: DSA interview prep');
    expect(block).toContain('audience_age: 18-24');
    expect(block).toContain('audience_type: students');
    expect(block).toContain('tone: direct, practical');
    expect(block).toContain('format: whiteboard');
    expect(block).toContain('never: jargon without explanation');
  });

  it('says "none given" instead of printing empty lists', () => {
    const block = formatDnaBlock({ ...dna, vocabulary: [], catchphrases: [] });
    expect(block).toContain('vocabulary: none given');
    expect(block).toContain('catchphrases: none given');
  });

  it('includes at most three sample posts', () => {
    const block = formatDnaBlock({
      ...dna,
      samplePosts: Array.from({ length: 6 }, (_unused, index) => ({ text: `sample ${index}` })),
    });
    expect(block).toContain('sample_voice:');
    expect(block).toContain('- sample 0');
    expect(block).not.toContain('- sample 3');
  });
});

describe('buildDnaContext', () => {
  it('stays inside the ~500 token budget', () => {
    const context = buildDnaContext({ uid: 'uid_1', dna, history: history(DNA_CONTEXT_HISTORY_LIMIT) });
    expect(context.tokens).toBeLessThanOrEqual(DNA_CONTEXT_TOKEN_BUDGET);
    expect(context.truncated).toBe(false);
  });

  it('labels the block with the uid and dna version', () => {
    const context = buildDnaContext({ uid: 'uid_1', dna });
    expect(context.text).toContain('CREATOR DNA (uid: uid_1, version 1)');
  });

  it('says "none yet" when there is no history', () => {
    const context = buildDnaContext({ uid: 'uid_1', dna, history: [] });
    expect(context.text).toContain('RECENT WORK: none yet');
    expect(context.historyItemsUsed).toBe(0);
    expect(context.truncated).toBe(false);
  });

  it('keeps only the most recent history items', () => {
    const context = buildDnaContext({ uid: 'uid_1', dna, history: history(3) });
    expect(context.historyItemsUsed).toBe(3);
    expect(context.text).toContain('Script number 0');
    expect(context.text).toContain('Script number 2');
  });

  it('never exceeds maxHistoryItems', () => {
    const context = buildDnaContext({
      uid: 'uid_1',
      dna,
      history: history(20),
      maxHistoryItems: 2,
    });
    expect(context.historyItemsUsed).toBe(2);
    expect(context.text).not.toContain('Script number 2');
  });

  it('drops history rather than blowing the budget', () => {
    const longHistory: DnaHistoryItem[] = Array.from({ length: 5 }, (_unused, index) => ({
      id: `long${index}`,
      kind: 'script' as const,
      createdAt: '2026-10-02T10:00:00.000Z',
      summary: 'x'.repeat(2000),
    }));

    const context = buildDnaContext({ uid: 'uid_1', dna, history: longHistory, maxTokens: 200 });

    expect(context.tokens).toBeLessThanOrEqual(200);
    expect(context.truncated).toBe(true);
    // Five were offered; only the ones that fit are kept.
    expect(context.historyItemsUsed).toBeGreaterThanOrEqual(0);
    expect(context.historyItemsUsed).toBeLessThan(5);
    // The DNA header itself is never dropped.
    expect(context.text).toContain('niche: DSA interview prep');
  });

  it('still emits a usable block when even the header is over budget', () => {
    const hugeDna = {
      ...dna,
      style: 'y'.repeat(4000),
      samplePosts: Array.from({ length: 3 }, () => ({ text: 'z'.repeat(1000) })),
    };
    const context = buildDnaContext({ uid: 'uid_1', dna: hugeDna, maxTokens: 50 });
    expect(context.text).toContain('CREATOR DNA');
    expect(context.tokens).toBeGreaterThan(50);
  });
});

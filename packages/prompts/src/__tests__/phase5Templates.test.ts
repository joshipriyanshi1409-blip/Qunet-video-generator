import { describe, expect, it } from 'vitest';
import { audienceMirrorResultSchema } from '@creatordna/shared';
import {
  improvedCopySchema,
  prompts,
  formatSegmentsBlock,
  formatFeedbackBlock,
} from '../index.js';

/**
 * Phase 5 templates.
 *
 * The registry's interpolation is strict in both directions: a variable the text
 * never uses throws, and a value the template never receives throws. These tests
 * pin the two new templates to their declared variable sets so the next phase
 * cannot silently drift one away from the other.
 */

/**
 * The DNA variables the Phase 5 templates accept.
 *
 * `dna_format` is deliberately absent: neither template interpolates it, and the
 * registry rejects a value the text never uses.
 */
const dnaVariables = {
  dna_niche: 'DSA interview prep for career switchers',
  dna_tone: 'direct, playful',
  dna_audience: 'Career switchers, Students',
  dna_audience_age: '25-34',
  dna_audience_type: 'professionals',
  dna_style: 'Short sentences, whiteboard, fast cuts',
  dna_personality: 'blunt, encouraging',
  dna_vocabulary: 'amortized',
  dna_catchphrases: 'Binary search in 30 seconds',
  dna_dos: 'dry run the code',
  dna_donts: 'jargon dumps',
};

describe('audience-mirror v1', () => {
  const template = prompts.get('audience-mirror');

  it('declares exactly the variables its text interpolates', () => {
    // `dna_format` is deliberately absent: the mirror judges the copy, not the
    // shooting format, and the registry rejects a variable the text never uses.
    expect(new Set(template.variables.map((variable) => variable.name))).toEqual(
      new Set([
        'content',
        'hook',
        'cta',
        ...Object.keys(dnaVariables),
        'segments_block',
      ]),
    );
  });

  it('renders the content, the two lines under test and the segment order', () => {
    const messages = prompts.render('audience-mirror', {
      content: 'POV: you finally understand binary search after 3 days',
      hook: 'POV: you finally understand binary search',
      cta: 'Follow for the next data structure',
      ...dnaVariables,
      segments_block: formatSegmentsBlock(['Students', 'Working professionals']),
    });

    expect(messages.user).toContain('POV: you finally understand binary search');
    expect(messages.user).toContain('Follow for the next data structure');
    // Order matters: the model is asked to answer in the same order it was asked.
    expect(messages.user.indexOf('1. Students')).toBeLessThan(
      messages.user.indexOf('2. Working professionals'),
    );
    // The system prompt carries the "analysis, never a promise" rule; the schema
    // carries the disclaimer itself so it can never be dropped.
    expect(messages.system).toContain('This is analysis, never a promise');
  });

  it('points at the shared result schema', () => {
    expect(template.outputSchema).toBe(audienceMirrorResultSchema);
  });

  it('asks for one prediction per segment, in order', () => {
    const messages = prompts.render('audience-mirror', {
      content: 'c',
      hook: 'h',
      cta: 'c',
      ...dnaVariables,
      segments_block: formatSegmentsBlock(['Students']),
    });
    expect(messages.user).toContain('one entry per segment listed above, in the same order');
  });
});

describe('improve-copy v1', () => {
  const template = prompts.get('improve-copy');

  it('declares exactly the variables its text interpolates', () => {
    expect(new Set(template.variables.map((variable) => variable.name))).toEqual(
      new Set([
        'target',
        'hook',
        'cta',
        'feedback_block',
        'dna_niche',
        'dna_tone',
        'dna_audience',
        'dna_style',
        'dna_personality',
        'dna_vocabulary',
        'dna_catchphrases',
        'dna_dos',
        'dna_donts',
      ]),
    );
  });

  it('renders the target, both current lines and the numbered feedback', () => {
    const messages = prompts.render('improve-copy', {
      target: 'cta',
      hook: 'POV: you finally understand binary search',
      cta: 'Follow for more',
      feedback_block: formatFeedbackBlock(['Name the time saved', 'Open with the mistake']),
      dna_niche: dnaVariables.dna_niche,
      dna_tone: dnaVariables.dna_tone,
      dna_audience: dnaVariables.dna_audience,
      dna_style: dnaVariables.dna_style,
      dna_personality: dnaVariables.dna_personality,
      dna_vocabulary: dnaVariables.dna_vocabulary,
      dna_catchphrases: dnaVariables.dna_catchphrases,
      dna_dos: dnaVariables.dna_dos,
      dna_donts: dnaVariables.dna_donts,
    });

    expect(messages.user).toContain('REWRITE TARGET: cta');
    expect(messages.user).toContain('CURRENT HOOK: POV: you finally understand binary search');
    expect(messages.user).toContain('CURRENT CTA: Follow for more');
    expect(messages.user).toContain('1. Name the time saved');
    expect(messages.user).toContain('2. Open with the mistake');
  });

  it('points at the improved-copy schema the service narrows', () => {
    expect(template.outputSchema).toBe(improvedCopySchema);
  });
});

describe('the Phase 5 formatting helpers', () => {
  it('numbers the segments, preserving the given order', () => {
    expect(formatSegmentsBlock(['Students', 'Founders'])).toBe(
      'SEGMENTS TO JUDGE (in this order)\n1. Students\n2. Founders',
    );
  });

  it('says so plainly when there are no segments', () => {
    expect(formatSegmentsBlock([])).toContain('none given');
  });

  it('numbers the feedback lines', () => {
    expect(formatFeedbackBlock(['a', 'b'])).toBe('1. a\n2. b');
  });

  it('never leaves the feedback block blank', () => {
    expect(formatFeedbackBlock([])).toContain('None recorded');
  });
});

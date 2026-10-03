import { describe, expect, it } from 'vitest';
import { creatorDnaSchema } from '@creatordna/shared';
import { prompts } from '../index.js';
import { formatSamplePostsBlock, NO_SAMPLE_POSTS } from '../templates/dna-extract.v1.js';

const answers = {
  niche: 'DSA interview prep for career switchers',
  audience_age_range: '25-34',
  audience_type: 'professionals',
  audience_description: 'Engineers with 2+ years of experience who freeze in interviews',
  tone: 'direct, practical, no hype',
  format: 'whiteboard',
  sample_posts_block: formatSamplePostsBlock([
    { text: 'Binary search in 30 seconds. Amortized analysis matters.' },
  ]),
};

describe('dna-extract v1 template', () => {
  it('is registered as version 1', () => {
    expect(prompts.latestVersion('dna-extract')).toBe(1);
    expect(prompts.list().map((entry) => entry.id)).toContain('dna-extract');
  });

  it('binds its output schema to the shared Creator DNA schema', () => {
    const template = prompts.get('dna-extract');
    expect(template.outputSchema).toBe(creatorDnaSchema);
  });

  it('renders both messages with every onboarding answer', () => {
    const { system, user } = prompts.render('dna-extract', answers);

    expect(system).toContain('Creator DNA profile');
    expect(system).toContain('strict JSON only');
    expect(user).toContain('niche: DSA interview prep for career switchers');
    expect(user).toContain('audience age range: 25-34');
    expect(user).toContain('audience type: professionals');
    expect(user).toContain('tone (creator\'s own words): direct, practical, no hype');
    expect(user).toContain('usual format: whiteboard');
    expect(user).toContain('1. Binary search in 30 seconds.');
  });

  it('declares exactly the variables the template uses', () => {
    const template = prompts.get('dna-extract');
    const rendered = prompts.render('dna-extract', answers);
    expect(template.variables.map((variable) => variable.name).sort()).toEqual(
      Object.keys(answers).sort(),
    );
    expect(rendered.user).not.toContain('{{');
  });

  it('throws on a missing variable instead of rendering an empty string', () => {
    const { niche: _niche, ...withoutNiche } = answers;
    expect(() => prompts.render('dna-extract', withoutNiche)).toThrow(/niche/);
  });

  it('throws on an unknown variable so renamed DNA fields fail loudly', () => {
    expect(() => prompts.render('dna-extract', { ...answers, dna_niche: 'x' })).toThrow(
      /dna_niche/,
    );
  });

  it('validates a well-formed model response', () => {
    const template = prompts.get('dna-extract');
    const parsed = template.outputSchema?.safeParse({
      niche: 'DSA interview prep',
      tone: ['direct'],
      audience: ['Career switchers'],
      style: 'Short sentences, whiteboard, fast cuts',
      personality: ['blunt'],
      format: 'whiteboard',
      vocabulary: ['amortized'],
      catchphrases: [],
      dos: [],
      donts: [],
      samplePosts: [{ text: 'Binary search in 30 seconds.' }],
      audienceAgeRange: '25-34',
      audienceType: 'professionals',
    });

    expect(parsed?.success).toBe(true);
  });

  it('rejects a model response that is missing a required field', () => {
    const template = prompts.get('dna-extract');
    const parsed = template.outputSchema?.safeParse({
      niche: 'DSA interview prep',
      tone: [],
      audience: ['Career switchers'],
      style: 'Short sentences',
      personality: ['blunt'],
      format: 'whiteboard',
    });

    expect(parsed?.success).toBe(false);
  });
});

describe('formatSamplePostsBlock', () => {
  it('numbers posts and keeps their url', () => {
    const block = formatSamplePostsBlock([
      { text: 'First post', url: 'https://example.com/a' },
      { text: 'Second post' },
    ]);
    expect(block).toBe('1. First post (https://example.com/a)\n2. Second post');
  });

  it('says so when the creator pasted nothing', () => {
    expect(formatSamplePostsBlock([])).toBe(NO_SAMPLE_POSTS);
  });
});

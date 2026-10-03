import { describe, expect, it } from 'vitest';
import {
  hookStyleSchema,
  singleHookResponseSchema,
  trendRemixSchema,
  trendRelevanceSchema,
} from '@creatordna/shared';
import { PromptRegistry } from '../registry.js';
import { formatCountInstruction, formatTrendBlock, hookLabV1 } from '../templates/hook-lab.v1.js';
import { formatTrendsBlock, trendRelevanceV1 } from '../templates/trend-relevance.v1.js';
import { formatIdeaBlock, trendRemixV1 } from '../templates/trend-remix.v1.js';

const dnaVariables = {
  dna_niche: 'DSA interview prep for career switchers',
  dna_tone: 'direct, playful',
  dna_audience: 'professionals, students',
  dna_audience_age: '25-34',
  dna_audience_type: 'professionals',
  dna_style: 'Short sentences, whiteboard, fast cuts',
  dna_personality: 'blunt, encouraging',
  dna_format: 'whiteboard',
  dna_vocabulary: 'amortized, invariant',
  dna_catchphrases: 'Binary search in 30 seconds',
  dna_dos: 'dry run the code',
  dna_donts: 'jargon dumps',
};

/** Relevance judging ignores habits, so those two are not passed to it. */
const { dna_dos: _dos, dna_donts: _donts, ...relevanceVariables } = dnaVariables;

const remixVariables = {
  trend_format: 'POV: you finally understand {concept} after {time}',
  trend_title: 'POV: you finally understand recursion',
  trend_description: 'Narrate the moment a concept clicks, then explain it in one line.',
  trend_category: 'education',
  ...dnaVariables,
  idea_block: formatIdeaBlock(undefined),
};

function render(id: string, variables: Record<string, string>) {
  const registry = new PromptRegistry();
  registry.register(trendRemixV1);
  registry.register(hookLabV1);
  registry.register(trendRelevanceV1);
  return registry.render(id, variables);
}

describe('trend-remix v1', () => {
  it('injects the DNA and the trend, leaving no placeholder behind', () => {
    const { system, user } = render('trend-remix', remixVariables);

    expect(system).toContain('recognizable structure');
    expect(user).toContain('TREND FORMAT: POV: you finally understand {concept} after {time}');
    expect(user).toContain('niche: DSA interview prep for career switchers');
    expect(user).toContain('tone: direct, playful');
    expect(user).toContain('vocabulary to reuse: amortized, invariant');
    expect(user).toContain('never do: jargon dumps');
    expect(user).not.toContain('{{');
  });

  it('tells the model to keep the structure and swap the topic', () => {
    const { system } = render('trend-remix', remixVariables);
    expect(system).toMatch(/structural skeleton/i);
    expect(system).toMatch(/topic/i);
  });

  it('demands the audit trail the UI shows', () => {
    const { system, user } = render('trend-remix', remixVariables);
    expect(user).toContain('"whatWasKept"');
    expect(user).toContain('"whatWasChanged"');
    expect(system).toMatch(/whatWasKept/);
  });

  it('formats the optional idea as "None" when the creator gave none', () => {
    expect(formatIdeaBlock(undefined)).toContain('None');
    expect(formatIdeaBlock('   ')).toContain('None');
    expect(formatIdeaBlock(' binary search ')).toContain('binary search');
  });

  it('carries a real creator idea into the prompt', () => {
    const { user } = render('trend-remix', {
      ...remixVariables,
      idea_block: formatIdeaBlock('Explain binary search to a nervous interviewee'),
    });
    expect(user).toContain('Explain binary search to a nervous interviewee');
  });

  it('points outputSchema at the shared schema so the contract cannot drift', () => {
    expect(trendRemixV1.outputSchema).toBe(trendRemixSchema);
  });

  it('validates a model answer that obeys the prompt', () => {
    const parsed = trendRemixSchema.parse({
      trendId: 'trend_pov_finally',
      format: 'POV: you finally understand {concept} after {time}',
      hook: 'POV: you finally understand binary search after 3 days',
      script: [
        { scene: 'Hook', text: 'POV: you have stared at binary search for three days.' },
        { scene: 'Turn', text: 'The trick is the picture of the search space halving.' },
        { scene: 'Proof', text: 'Amortized analysis says the invariant holds.' },
      ],
      cta: 'Follow for the next data structure in plain English.',
      caption: 'Binary search finally clicked.',
      hashtags: ['#dsa', '#interviewprep', '#learncode'],
      whatWasKept: ['POV opening', 'three-beat escalation'],
      whatWasChanged: ['topic swapped to binary search', 'CTA swapped to follow'],
    });
    expect(parsed.script).toHaveLength(3);
    expect(parsed.whatWasKept).toHaveLength(2);
  });
});

describe('hook-lab v1', () => {
  const variables = {
    idea: 'Explain binary search to someone who has never coded',
    ...dnaVariables,
    trend_block: formatTrendBlock(undefined),
    count_instruction: formatCountInstruction(6),
  };

  it('names the six styles and bans repetition', () => {
    const { system } = render('hook-lab', variables);
    for (const style of ['question', 'bold-claim', 'pov', 'story', 'contrarian', 'curiosity-gap']) {
      expect(system).toContain(style);
    }
    expect(system).toMatch(/never repeat a style/i);
  });

  it('injects the DNA and the idea', () => {
    const { user } = render('hook-lab', variables);
    expect(user).toContain('IDEA: Explain binary search to someone who has never coded');
    expect(user).toContain('niche: DSA interview prep for career switchers');
    expect(user).toContain('Write exactly 6 hooks, each in a DIFFERENT style');
    expect(user).not.toContain('{{');
  });

  it('includes the trend when the creator arrived from one', () => {
    const { user } = render('hook-lab', {
      ...variables,
      trend_block: formatTrendBlock({
        title: 'POV: you finally understand it',
        format: 'POV: you finally {x}',
      }),
    });
    expect(user).toContain('TREND BEING REMIXED: POV: you finally understand it');
  });

  it('validates a set of distinct-style hooks', () => {
    const parsed = hookLabV1.outputSchema?.parse({
      hooks: [
        { id: 'h1', text: 'Why does your binary search never terminate?', style: 'question', whyItWorks: 'Names a bug they have hit.' },
        { id: 'h2', text: 'Binary search is 8 lines. Everyone writes 30.', style: 'bold-claim', whyItWorks: 'Concrete and checkable.' },
        { id: 'h3', text: 'POV: the search space just halved.', style: 'pov', whyItWorks: 'Puts them inside the algorithm.' },
        { id: 'h4', text: 'I watched 400 interviews fail on the same line.', style: 'story', whyItWorks: 'Opens mid-scene.' },
        { id: 'h5', text: 'Stop memorising binary search.', style: 'contrarian', whyItWorks: 'Attacks the obvious advice.' },
        { id: 'h6', text: 'The bug is never in the loop.', style: 'curiosity-gap', whyItWorks: 'Forces a click.' },
      ],
    });
    expect(parsed?.hooks).toHaveLength(6);
    expect(new Set(parsed?.hooks.map((hook) => hook.style)).size).toBe(6);
  });

  it('rejects a style outside the closed set', () => {
    expect(hookStyleSchema.safeParse('listicle').success).toBe(false);
  });

  it('can ask for a single hook in one style, for "regenerate just this one"', () => {
    expect(formatCountInstruction(6)).toContain('DIFFERENT style');
    expect(formatCountInstruction(1, 'pov')).toBe('Write exactly ONE hook, and it must use the "pov" style.');

    const parsed = singleHookResponseSchema.parse({
      hooks: [
        { id: 'h1', text: 'POV: the search space just halved.', style: 'pov', whyItWorks: 'Puts them inside the algorithm.' },
      ],
    });
    expect(parsed.hooks).toHaveLength(1);
    expect(singleHookResponseSchema.safeParse({ hooks: [] }).success).toBe(false);
  });
});

describe('trend-relevance v1', () => {
  const trends = [
    {
      id: 'trend_pov_finally',
      title: 'POV: you finally understand it',
      format: 'POV: you finally understand {concept} after {time}',
      description: 'Narrate the moment a concept clicks.',
      category: 'education',
    },
    {
      id: 'trend_three_mistakes',
      title: 'Three mistakes keeping you broke',
      format: '{number} mistakes keeping you {outcome}',
      description: 'Count down the mistakes, one fix each.',
      category: 'finance',
    },
  ];

  const variables = {
    ...relevanceVariables,
    trends_block: formatTrendsBlock(trends),
  };

  it('numbers the trends so ids can be echoed back', () => {
    const block = formatTrendsBlock(trends);
    expect(block.split('\n')).toHaveLength(2);
    expect(block).toContain('1. trend_pov_finally');
    expect(block).toContain('2. trend_three_mistakes');
    expect(block).toContain('category: education');
  });

  it('tells the model to ignore popularity and judge fit', () => {
    const { system } = render('trend-relevance', variables);
    expect(system).toMatch(/ignore it/i);
    expect(system).toMatch(/fit/i);
  });

  it('injects the DNA and every trend id', () => {
    const { user } = render('trend-relevance', variables);
    expect(user).toContain('niche: DSA interview prep for career switchers');
    expect(user).toContain('trend_pov_finally');
    expect(user).toContain('trend_three_mistakes');
    expect(user).not.toContain('{{');
  });

  it('validates a score for every trend it was given', () => {
    const parsed = trendRelevanceSchema.parse({
      scores: [
        { trendId: 'trend_pov_finally', relevance: 82, reasons: ['your audience is beginners and this teaches one thing'] },
        { trendId: 'trend_three_mistakes', relevance: 21, reasons: ['finance is outside your niche'] },
      ],
    });
    expect(parsed.scores).toHaveLength(2);
    expect(parsed.scores[0]?.relevance).toBe(82);
  });

  it('rejects a score outside 0-100 and an empty score list', () => {
    expect(trendRelevanceSchema.safeParse({ scores: [] }).success).toBe(false);
    expect(
      trendRelevanceSchema.safeParse({ scores: [{ trendId: 't', relevance: 140, reasons: [] }] })
        .success,
    ).toBe(false);
  });
});

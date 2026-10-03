import { describe, expect, it } from 'vitest';
import { dnaSuggestionSetSchema } from '@creatordna/shared';
import { prompts } from '../index.js';
import { formatSignalsBlock } from '../templates/dna-learn.v1.js';

const variables = {
  dna_niche: 'DSA interview prep',
  dna_tone: 'direct, practical',
  dna_audience: 'Career switchers',
  dna_style: 'Short sentences, whiteboard, fast cuts',
  dna_personality: 'blunt, encouraging',
  dna_vocabulary: 'amortized',
  dna_catchphrases: 'Binary search in 30 seconds',
  dna_dos: 'dry run the code',
  dna_donts: 'jargon dumps',
  signals_block: formatSignalsBlock([
    { id: 'sig_1', kind: 'hook_chosen', label: 'Three signs your study routine is broken' },
    { id: 'sig_2', kind: 'remix_approved', label: 'Off-by-one errors, explained' },
  ]),
};

describe('dna-learn v1 template', () => {
  it('is registered as version 1', () => {
    expect(prompts.latestVersion('dna-learn')).toBe(1);
    expect(prompts.list().map((entry) => entry.id)).toContain('dna-learn');
  });

  it('binds its output schema to the shared suggestion-set schema', () => {
    expect(prompts.get('dna-learn').outputSchema).toBe(dnaSuggestionSetSchema);
  });

  it('renders both messages with the profile and every signal id', () => {
    const { system, user } = prompts.render('dna-learn', variables);

    expect(system).toContain('You PROPOSE');
    expect(user).toContain('DSA interview prep');
    expect(user).toContain('amortized');
    expect(user).toContain('jargon dumps');
    // The ids are what the model has to cite back, so they must survive rendering.
    expect(user).toContain('[sig_1]');
    expect(user).toContain('[sig_2]');
    expect(user).toContain('Three signs your study routine is broken');
  });

  it('never leaves an unbound variable behind', () => {
    const { system, user } = prompts.render('dna-learn', variables);

    expect(system).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(user).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('formats an empty signal list as an explicit statement, not a blank', () => {
    expect(formatSignalsBlock([])).toBe('No signals recorded yet.');
  });

  it('tells the model it may return nothing rather than inventing a proposal', () => {
    const { system } = prompts.render('dna-learn', variables);

    expect(system).toContain('An empty list is a valid answer');
  });

  it('forbids touching niche and format, which are identity not style', () => {
    const { system } = prompts.render('dna-learn', variables);

    expect(system).toContain('never propose');
    expect(system).toContain('niche');
    expect(system).toContain('format');
  });
});

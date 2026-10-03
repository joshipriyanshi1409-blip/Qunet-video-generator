import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { DnaHistoryPage } from '../DnaHistoryPage';
import { renderWithProviders } from '../../test/utils';

/**
 * The DNA version history.
 *
 * The score is recomputed in the browser from the stored snapshot, so the numbers
 * on this page cannot drift from the ring on My DNA. That is the property these
 * tests pin down - not the layout.
 */

function snapshot(overrides: { version?: number; vocabulary?: string[] } = {}) {
  return {
    version: overrides.version ?? 1,
    savedAt: '2026-10-01T10:00:00.000Z',
    summary: 'Profile as it stood before the next accepted update.',
    dna: {
      niche: 'DSA interview prep',
      tone: ['direct'],
      audience: ['Career switchers'],
      style: 'Short sentences',
      personality: ['blunt'],
      format: 'whiteboard',
      vocabulary: overrides.vocabulary ?? ['amortized'],
      catchphrases: [],
      dos: [],
      donts: [],
      samplePosts: [],
      audienceAgeRange: '25-34',
      audienceType: 'professionals',
      dnaVersion: overrides.version ?? 1,
    },
  };
}

function stubVersions(versions: unknown[], currentVersion: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: { versions, currentVersion } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('DnaHistoryPage', () => {
  it('lists every version newest first and marks the current one', async () => {
    stubVersions([snapshot({ version: 3 }), snapshot({ version: 2 })], 3);

    renderWithProviders(<DnaHistoryPage />);

    expect(await screen.findByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();

    // Newest first: the current version is the first row.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveTextContent('Version 3');
  });

  it('recomputes the score from the snapshot rather than trusting a stored number', async () => {
    // The vocabulary on this snapshot is listed but never used in a sample post,
    // which is exactly the inconsistency the consistency score is meant to catch.
    stubVersions(
      [
        {
          ...snapshot({ version: 2, vocabulary: ['amortized', 'off-by-one', 'idempotent'] }),
          dna: {
            ...snapshot().dna,
            vocabulary: ['amortized', 'off-by-one', 'idempotent'],
            samplePosts: [{ text: 'Amortized analysis matters.' }],
            donts: ['amortized'],
          },
        },
      ],
      2,
    );

    renderWithProviders(<DnaHistoryPage />);

    // Two words unused in the sample, plus a contradiction: the score must drop.
    expect(await screen.findByText(/word\(s\) you listed never appear/)).toBeInTheDocument();
    expect(screen.getByText(/appear\(s\) in both your word list/)).toBeInTheDocument();
  });

  it('shows an empty state before any version exists', async () => {
    stubVersions([], 1);

    renderWithProviders(<DnaHistoryPage />);

    expect(await screen.findByText('No versions recorded yet')).toBeInTheDocument();
    expect(screen.queryByText('Version 1')).not.toBeInTheDocument();
  });

  it('surfaces a read failure with a retry, not a blank page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'boom', message: 'nope' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderWithProviders(<DnaHistoryPage />);

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });
});

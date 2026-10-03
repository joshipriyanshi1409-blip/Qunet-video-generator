import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { SuggestedUpdates } from '../dna/SuggestedUpdates';
import { ToastViewport } from '../Toast';
import { renderWithProviders } from '../../test/utils';

/**
 * The suggestions panel.
 *
 * The behaviour that matters most here is the one the product promises: a
 * proposal is inert until a human accepts it. Most of these tests exist to stop
 * a future change from quietly making the panel write to the DNA on its own.
 */

const pending = [
  {
    id: 'sug_1',
    field: 'vocabulary' as const,
    action: 'add' as const,
    status: 'pending' as const,
    createdAt: '2026-10-01T11:00:00.000Z',
    resolvedAt: null,
    value: ['off-by-one'],
    rationale: 'You keep picking hooks about boundary bugs.',
    evidence: ['sig_1'],
    promptId: 'dna-learn',
    promptVersion: 1,
    model: 'stub-model',
  },
];

function stubApi(options: { suggestions?: unknown[]; signals?: unknown[] } = {}) {
  const calls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/dna/signals')) {
        return new Response(
          JSON.stringify({
            data: {
              signals: options.signals ?? [
                {
                  id: 'sig_1',
                  kind: 'hook_chosen',
                  createdAt: '2026-10-01T10:00:00.000Z',
                  label: 'Off-by-one errors, explained',
                  source: 'hook-lab',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/suggestions/') && url.includes('/accept')) {
        return new Response(JSON.stringify({ data: acceptedProfile }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/suggestions/') && url.includes('/reject')) {
        return new Response(
          JSON.stringify({ data: { ...pending[0], status: 'rejected' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/suggestions')) {
        return new Response(
          JSON.stringify({ data: { suggestions: options.suggestions ?? pending, skipped: false } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  return calls;
}

const acceptedProfile = {
  dna: {
    niche: 'DSA interview prep',
    tone: ['direct'],
    audience: ['Career switchers'],
    style: 'Short sentences',
    personality: ['blunt'],
    format: 'whiteboard',
    vocabulary: ['amortized', 'off-by-one'],
    catchphrases: [],
    dos: [],
    donts: [],
    samplePosts: [],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
    dnaVersion: 2,
  },
  score: {
    completeness: 90,
    consistency: 100,
    score: 93,
    missingFields: [],
    inconsistencies: [],
    dnaVersion: 2,
  },
  context: 'ctx',
  contextTokens: 10,
};

/**
 * Mounts the panel together with the toast viewport.
 *
 * `renderWithProviders` wraps query + router only; the toast host lives in
 * `AppLayout`, so without it a confirmation is pushed to a store nothing is
 * rendering and the assertion would pass for the wrong reason.
 */
function renderPanel() {
  return renderWithProviders(
    <>
      <SuggestedUpdates />
      <ToastViewport />
    </>,
  );
}

describe('SuggestedUpdates', () => {
  it('shows the proposal with its value, reason and evidence', async () => {
    stubApi();
    renderPanel();

    expect(await screen.findByText('off-by-one')).toBeInTheDocument();
    expect(screen.getByText('You keep picking hooks about boundary bugs.')).toBeInTheDocument();
    expect(screen.getByText(/Add to Vocabulary/i)).toBeInTheDocument();
    expect(screen.getByText(/from 1 recent choice/i)).toBeInTheDocument();
  });

  it('names the signal the proposal came from, not just its id', async () => {
    stubApi();
    renderPanel();

    fireEvent.click(await screen.findByText('What this was based on'));

    expect(await screen.findByText('Off-by-one errors, explained')).toBeInTheDocument();
    expect(screen.queryByText('sig_1')).not.toBeInTheDocument();
  });

  it('does not write anything until the creator accepts', async () => {
    const calls = stubApi();
    renderPanel();

    // Rendering alone must not touch the DNA.
    await screen.findByText('off-by-one');
    expect(calls.some((url) => url.includes('/accept'))).toBe(false);

    const before = await waitFor(() => calls.filter((url) => url.includes('/dna/suggestions')).length);
    expect(before).toBeGreaterThan(0);
  });

  it('accepting posts to the accept endpoint and confirms', async () => {
    const calls = stubApi();
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/suggestions/sug_1/accept'))).toBe(true);
    });
    expect(await screen.findByText('DNA updated')).toBeInTheDocument();
  });

  it('rejecting posts to the reject endpoint and confirms', async () => {
    const calls = stubApi();
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Not for me' }));

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/suggestions/sug_1/reject'))).toBe(true);
    });
    expect(await screen.findByText('Suggestion dismissed')).toBeInTheDocument();
  });

  it('shows an empty state when there is nothing pending', async () => {
    stubApi({ suggestions: [] });
    renderPanel();

    expect(await screen.findByText('No suggestions right now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('treats "nothing new" as all caught up, not as an error', async () => {
    stubApi({ suggestions: [] });
    renderPanel();
    await screen.findByText('No suggestions right now');

    // Override the generate response for the POST that follows.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/generate')) {
          return new Response(
            JSON.stringify({
              data: { suggestions: [], skipped: true, reason: 'no-new-signals' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ data: { suggestions: [], skipped: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Review my activity/i }));

    expect(await screen.findByText('All caught up')).toBeInTheDocument();
  });
});

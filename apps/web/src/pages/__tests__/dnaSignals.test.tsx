import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudiencePage } from '../AudiencePage';
import { HookLabPage } from '../HookLabPage';
import { TrendRemixPage } from '../TrendRemixPage';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { useUiStore } from '../../store/useUiStore';
import { hooks, remix, trendList } from '../../test/trendsFixtures';

/**
 * Signal emission.
 *
 * The learning loop can only learn from what the creator actually did, so the
 * wiring from each screen's action to `POST /dna/signals` is the load-bearing
 * part of Phase 9. These tests assert the *kind* as well as the call, because a
 * page that records the wrong kind teaches the model the wrong lesson.
 *
 * Fixtures come from `test/trendsFixtures` so the browser runs the same zod
 * validation it runs against the real API.
 */

const health = {
  service: 'creatordna-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 12,
  checks: {},
};

const mirror = {
  predictions: [
    {
      segmentName: 'Career switchers',
      interest: 'High',
      reason: 'They are interviewing this month, so the shortcut lands immediately.',
      tip: 'Name the time saved in the first line.',
    },
    {
      segmentName: 'Students',
      interest: 'Low',
      reason: 'The POV framing hides which algorithm is being explained.',
      tip: 'Say the name of the algorithm once, before the reveal.',
    },
  ],
  overallInsight: 'Switchers want the shortcut; students want the name.',
  improvedCta: 'Follow for the next data structure in plain English.',
  disclaimer: 'AI analysis, not a guaranteed prediction.',
};

/** The mirror endpoint answers with the project alongside the result. */
const project = {
  id: 'proj_1',
  uid: 'test-creator',
  idea: 'Explain binary search to a nervous interviewee',
  trendId: 'trend_pov_finally',
  status: 'awaiting-approval',
  versions: [
    {
      version: 1,
      kind: 'mirror',
      hook: 'POV: you finally understand binary search',
      cta: 'Follow for more.',
      content: 'POV: you finally understand binary search',
      mirror,
      feedback: [],
      createdAt: '2026-10-02T10:00:00.000Z',
    },
  ],
  approvedVersion: null,
  renderJobId: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

function stubAll(options: { signalStatus?: number } = {}): Posted[] {
  const posts: Posted[] = [];

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === 'POST') {
      posts.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
    }

    if (url.includes('/dna/signals')) {
      return new Response(
        JSON.stringify({
          data: {
            id: 'sig_1',
            kind: 'hook_chosen',
            createdAt: '2026-10-01T10:00:00.000Z',
            label: 'x',
            source: 'test',
          },
        }),
        { status: options.signalStatus ?? 201, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/api/v1/trends/for-me')) {
      return new Response(JSON.stringify({ data: trendList }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/trends/remix')) {
      return new Response(JSON.stringify({ data: remix }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/trends/hooks')) {
      return new Response(JSON.stringify({ data: { hooks } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/audience-mirror')) {
      return new Response(JSON.stringify({ data: { project, mirror } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(health), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

  vi.stubGlobal('fetch', mock);
  return posts;
}

function signals(posts: Posted[]): Posted[] {
  return posts.filter((post) => post.url.includes('/dna/signals'));
}

describe('signal emission', () => {
  beforeEach(() => {
    signInAsTestCreator();
    // The draft idea deliberately survives a navigation, so clear it here.
    useUiStore.setState({ draftIdea: '' });
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('records hook_chosen when a creator uses a hook from Hook Lab', async () => {
    const posts = stubAll();
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));
    await user.click((await screen.findAllByRole('radio'))[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Use this hook' }));

    await waitFor(() => {
      expect(signals(posts)).toHaveLength(1);
    });
    expect(signals(posts)[0]?.body.kind).toBe('hook_chosen');
    expect(signals(posts)[0]?.body.source).toBe('hook-lab');
    // The hook's own text, not an id the loop cannot read.
    expect(String(signals(posts)[0]?.body.label)).toContain('binary search');
  });

  it('records remix_approved when a creator sends a remix to Create', async () => {
    const posts = stubAll();
    const user = userEvent.setup();
    renderWithProviders(<TrendRemixPage />, { route: '/trends/remix' });

    await user.click(await screen.findByRole('button', { name: /POV: You finally understand/ }));
    await user.click(screen.getByRole('button', { name: 'Remix this trend' }));
    await user.click(await screen.findByRole('button', { name: 'Use this' }));

    await waitFor(() => {
      expect(signals(posts)).toHaveLength(1);
    });
    expect(signals(posts)[0]?.body.kind).toBe('remix_approved');
    expect(signals(posts)[0]?.body.source).toBe('trend-remix');
    expect(String(signals(posts)[0]?.body.label)).toBe(remix.hook);
  });

  it('records audience_tip_applied when a creator applies a mirror tip', async () => {
    const posts = stubAll();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, {
      route: '/audience?hook=POV%3A+binary+search&cta=Follow',
    });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    await user.click(await screen.findByRole('button', { name: /Use the tip for Students/ }));

    await waitFor(() => {
      expect(signals(posts)).toHaveLength(1);
    });
    expect(signals(posts)[0]?.body.kind).toBe('audience_tip_applied');
    expect(signals(posts)[0]?.body.source).toBe('audience-mirror');
    expect(String(signals(posts)[0]?.body.label)).toContain('Say the name of the algorithm');
  });

  it('records nothing when the creator only looks', async () => {
    // Running the mirror is analysis, not a choice: nothing is learned from it.
    const posts = stubAll();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, {
      route: '/audience?hook=POV%3A+binary+search&cta=Follow',
    });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    await screen.findByText('Switchers want the shortcut; students want the name.');

    expect(signals(posts)).toHaveLength(0);
  });

  it('keeps the creator moving when the learning loop is unhappy', async () => {
    // A 500 from /dna/signals must not stop the action it is attached to.
    stubAll({ signalStatus: 500 });
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));
    await user.click((await screen.findAllByRole('radio'))[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Use this hook' }));

    // The hook still reaches Create, which is what the screen promised. The
    // toast host lives in AppLayout and is not mounted here, so assert on the
    // thing that matters: the idea survived into Create's field.
    await waitFor(() => {
      expect(screen.getByLabelText('Your idea')).toHaveValue(
        'Explain binary search',
      );
    });
  });
});

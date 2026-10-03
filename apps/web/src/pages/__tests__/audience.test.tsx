import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudiencePage } from '../AudiencePage';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { useUiStore } from '../../store/useUiStore';
import { useToastStore } from '../../store/useToastStore';

/**
 * The Audience Mirror screen, end to end.
 *
 * This is the Phase 5 acceptance test on the front end: mirror -> read the
 * segments -> improve -> approve, with the disclaimer visible throughout and the
 * revise path carrying the feedback back out.
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

const improved = {
  hook: 'POV: you finally understand binary search',
  cta: 'Follow for the next data structure in plain English.',
};

interface StubOptions {
  mirrorStatus?: number;
  improveStatus?: number;
  approveStatus?: number;
}

/** Routes the mirror/improve/approve endpoints, recording the requests. */
function stubFetch(options: StubOptions = {}): Mock {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    if (url.includes('/api/v1/audience-mirror')) {
      const status = options.mirrorStatus ?? 200;
      if (status !== 200) return errorBody(status, 'The model is unavailable.');
      return new Response(
        JSON.stringify({ data: { project, mirror } }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/api/v1/improve')) {
      const status = options.improveStatus ?? 200;
      return new Response(
        JSON.stringify({ data: { project, target: 'cta', improved, mirror } }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/api/v1/projects/')) {
      const status = options.approveStatus ?? 200;
      if (status !== 200) {
        return errorBody(status, 'Job queue unavailable (REDIS_ENABLED=false).');
      }
      return new Response(
        JSON.stringify({
          data: {
            project: { ...project, status: 'rendering', renderJobId: 'job_1' },
            job: { jobId: 'job_1', queue: 'render', state: 'waiting' },
          },
        }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(health), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as Mock;

  vi.stubGlobal('fetch', mock);
  mock.mock.calls.forEach(() => undefined);
  // Expose the recorded calls for assertions.
  Object.defineProperty(mock, 'recorded', { value: calls });
  return mock;
}

/** The API's error envelope, so the web client surfaces the real message. */
function errorBody(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: 'service_unavailable', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

const route = '/audience?hook=POV%3A%20you%20finally%20understand%20binary%20search&cta=Follow%20for%20more.';

describe('AudiencePage', () => {
  beforeEach(() => {
    signInAsTestCreator();
    // Zustand stores are module-level and leak between tests in a file.
    useUiStore.setState({ mirrorFeedback: [] });
    useToastStore.getState().clear();
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('prefills the hook and CTA from the remix', () => {
    stubFetch();
    renderWithProviders(<AudiencePage />, { route });

    expect(screen.getByLabelText('Hook')).toHaveValue(
      'POV: you finally understand binary search',
    );
    expect(screen.getByLabelText('Call to action')).toHaveValue('Follow for more.');
  });

  it('shows a segment card per prediction with a High/Medium/Low badge', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));

    expect(await screen.findByText('Career switchers')).toBeInTheDocument();
    expect(screen.getByText('Students')).toBeInTheDocument();

    // Two badges: one High, one Low.
    const badges = screen.getAllByLabelText(/Predicted reaction:/);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('High');
    expect(badges[1]).toHaveTextContent('Low');
    expect(badges[0]).toHaveAttribute('data-reaction', 'high');
    expect(badges[1]).toHaveAttribute('data-reaction', 'low');
  });

  it('shows the AI insight box and the disclaimer', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));

    expect(await screen.findByRole('heading', { name: 'AI insight' })).toBeInTheDocument();
    expect(screen.getByText('Switchers want the shortcut; students want the name.')).toBeInTheDocument();
    // The disclaimer is visible, not buried in a tooltip.
    expect(screen.getByText('AI analysis, not a guaranteed prediction.')).toBeInTheDocument();
  });

  it('suggests an improved CTA and rewrites it on request', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    expect(
      await screen.findByText('Follow for the next data structure in plain English.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Improve the CTA' }));

    // The rewritten CTA lands in the form, so the next mirror tests the new line.
    await waitFor(() => {
      expect(screen.getByLabelText('Call to action')).toHaveValue(
        'Follow for the next data structure in plain English.',
      );
    });

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.map(([, init]) => init?.body as string)).toHaveLength(2);
    const improveBody = JSON.parse(String(posts[1]?.[1]?.body)) as {
      target: string;
      projectId: string;
      recheck?: boolean;
    };
    expect(improveBody.target).toBe('cta');
    expect(improveBody.projectId).toBe('proj_1');
  });

  it('steers the rewrite with the tip the creator picked', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    await user.click(await screen.findByRole('button', { name: /Use the tip for Students/ }));

    await user.click(screen.getByRole('button', { name: 'Improve the hook' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
      // Selected by URL, not by index: applying a tip also records a learning
      // signal, so the number of POSTs on this screen is not fixed. Asserting on
      // `posts[1]` would silently start testing the signal instead of the rewrite.
      const improve = posts.find(([url]) => String(url).includes('/api/v1/improve'));
      expect(improve).toBeDefined();
      const improveBody = JSON.parse(String(improve?.[1]?.body)) as { feedback: string[] };
      expect(improveBody.feedback).toEqual([
        'Say the name of the algorithm once, before the reveal.',
      ]);
    });
  });

  it('approves, enqueues the render and navigates to the job', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    await user.click(await screen.findByRole('button', { name: 'Approve and render' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
      // mirror + approve
      expect(posts).toHaveLength(2);
      const approveUrl = String(posts[1]?.[0]);
      expect(approveUrl).toContain('/api/v1/projects/proj_1/approve');
      const approveBody = JSON.parse(String(posts[1]?.[1]?.body)) as {
        projectId: string;
        hook: string;
        cta: string;
        script: { scene: string; text: string }[];
      };
      expect(approveBody.projectId).toBe('proj_1');
      expect(approveBody.hook).toBe('POV: you finally understand binary search');
      expect(approveBody.script.length).toBeGreaterThan(0);
    });
  });

  it('explains itself when the render queue is unavailable', async () => {
    stubFetch({ approveStatus: 503 });
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    await user.click(await screen.findByRole('button', { name: 'Approve and render' }));

    // Toasts render in a viewport the test harness does not mount, so assert on
    // the store - the same approach the onboarding tests use.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.map((toast) => toast.description ?? toast.title).join(' ')).toMatch(
        /job queue is not running/i,
      );
    });
  });

  it('revise carries the mirror feedback back out to Trend Remix', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));
    await user.click(await screen.findByRole('button', { name: 'Revise in Trend Remix' }));

    // The feedback lands in the shared store, where Trend Remix reads it.
    await waitFor(() => {
      expect(useUiStore.getState().mirrorFeedback).toEqual([
        'Career switchers: Name the time saved in the first line.',
        'Students: Say the name of the algorithm once, before the reveal.',
      ]);
    });
  });

  it('renders an error state when the mirror call fails', async () => {
    stubFetch({ mirrorStatus: 503 });
    const user = userEvent.setup();
    renderWithProviders(<AudiencePage />, { route });

    await user.click(screen.getByRole('button', { name: 'Run the mirror' }));

    // The toast live region and the ErrorState both carry role="alert"; scope to
    // the ErrorState heading so the assertion is unambiguous.
    expect(await screen.findByText('Could not load this')).toBeInTheDocument();
    expect(screen.queryByText('Career switchers')).not.toBeInTheDocument();
  });
});

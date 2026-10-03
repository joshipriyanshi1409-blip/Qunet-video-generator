import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrendRemixPage } from '../TrendRemixPage';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { remix, trendList } from '../../test/trendsFixtures';

const health = {
  service: 'creatordna-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 12,
  checks: {},
};

/** Routes the fixture responses by URL, recording what was requested. */
function stubFetch(
  responses: {
    trends?: unknown;
    remix?: unknown;
    remixStatus?: number;
  } = {},
): Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>> {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    if (url.includes('/api/v1/trends/for-me')) {
      return new Response(JSON.stringify({ data: responses.trends ?? trendList }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/trends/remix')) {
      if (responses.remixStatus !== undefined) {
        return new Response(
          JSON.stringify({ error: { code: 'ai_unavailable', message: 'The model is down.' } }),
          { status: responses.remixStatus, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: responses.remix ?? remix }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(health), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

  mock.mock.calls.forEach(() => undefined);
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('TrendRemixPage', () => {
  beforeEach(() => {
    signInAsTestCreator();
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('lists the ranked catalogue with relevance percentages', async () => {
    stubFetch();
    renderWithProviders(<TrendRemixPage />);

    expect(await screen.findByRole('heading', { name: '1. Pick a trend' })).toBeInTheDocument();
    expect(await screen.findByText('POV: You finally understand ...')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('shows a skeleton while the ranking loads', async () => {
    // A never-resolving fetch keeps the query pending so the skeleton stays up.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/v1/trends/for-me')) {
          return await new Promise<Response>(() => undefined);
        }
        return new Response(JSON.stringify(health), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderWithProviders(<TrendRemixPage />);
    expect(screen.getByText('Ranking the catalogue…')).toBeInTheDocument();
  });

  it('remixes a selected trend and shows the original beside your version', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<TrendRemixPage />);

    await user.click(await screen.findByRole('button', { name: /POV: You finally understand/ }));
    await user.click(screen.getByRole('button', { name: 'Remix this trend' }));

    expect(await screen.findByRole('heading', { name: 'Your version' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Original trend' })).toBeInTheDocument();
    // The hook appears twice on purpose: in the comparison card and in the
    // expandable Hook section.
    expect(
      screen.getAllByText('POV: you finally understand binary search after 3 days').length,
    ).toBeGreaterThan(0);

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[1]?.body).toContain('trend_pov_finally');
  });

  it('opens Hook / Script / CTA as expandable sections', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<TrendRemixPage />, { route: '/trends/remix?trendId=trend_pov_finally' });

    await user.click(await screen.findByRole('button', { name: 'Remix this trend' }));
    expect(await screen.findByRole('heading', { name: 'Your version' })).toBeInTheDocument();

    // Script and CTA are open by default; the audit trail is collapsed.
    const audit = screen.getByRole('button', { name: /What was kept and what changed/ });
    expect(audit).toHaveAttribute('aria-expanded', 'false');
    await user.click(audit);
    expect(audit).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('the POV opening')).toBeInTheDocument();
  });

  it('regenerates on demand', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<TrendRemixPage />, { route: '/trends/remix?trendId=trend_pov_finally' });

    await user.click(await screen.findByRole('button', { name: 'Remix this trend' }));
    await screen.findByRole('heading', { name: 'Your version' });

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(posts.length).toBe(2);
    });
  });

  it('shows an error state with a retry when the model fails', async () => {
    stubFetch({ remixStatus: 503 });
    const user = userEvent.setup();
    renderWithProviders(<TrendRemixPage />, { route: '/trends/remix?trendId=trend_pov_finally' });

    await user.click(await screen.findByRole('button', { name: 'Remix this trend' }));

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent('The model is down.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks the creator to onboard when there is no DNA yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/v1/trends/for-me')) {
          return new Response(
            JSON.stringify({ error: { code: 'not_found', message: 'No Creator DNA yet' } }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify(health), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderWithProviders(<TrendRemixPage />);
    expect(
      await screen.findByRole('heading', { name: 'Build your Creator DNA first' }),
    ).toBeInTheDocument();
  });

  it('accepts a free-text idea with no trend selected', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<TrendRemixPage />);

    await user.type(
      await screen.findByLabelText('Your idea'),
      'Explain binary search to a nervous interviewee',
    );
    await user.click(screen.getByRole('button', { name: 'Remix my idea' }));

    await screen.findByRole('heading', { name: 'Your version' });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeDefined();
    expect(post?.[1]?.body).toContain('Explain binary search');
    expect(post?.[1]?.body).not.toContain('trendId');
  });
});

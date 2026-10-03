import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { trendList } from '../../test/trendsFixtures';

/**
 * Every screen under `/` is auth-gated, so these tests sign in as a local
 * creator first (the dev bypass path - see `src/test/auth.ts`).
 */
describe('app shell', () => {
  beforeEach(() => {
    signInAsTestCreator();
  });

  afterEach(() => {
    signOutTestCreator();
  });

  it('renders the primary navigation items', () => {
    renderWithProviders(<App />, { route: '/' });

    const navs = screen.getAllByRole('navigation', { name: 'Primary' });
    expect(navs.length).toBeGreaterThan(0);

    const nav = navs[0];
    for (const label of ['Home', 'Create', 'My DNA', 'Trend Remix', 'Hook Lab', 'Audience']) {
      expect(nav).toHaveTextContent(label);
    }
  });

  it('lists the render tools in the secondary navigation', () => {
    // The render journey's two screens live under the studio tools, so they are
    // reachable from anywhere without going back through Create.
    renderWithProviders(<App />, { route: '/' });

    const nav = screen.getByRole('navigation', { name: 'Tools' });
    for (const label of ['Voice Coach', 'Library']) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByRole('link', { name: /Library/ })).toHaveAttribute('href', '/library');
  });

  it('marks the active route with aria-current', () => {
    renderWithProviders(<App />, { route: '/dna' });

    const active = screen.getAllByRole('link', { name: /My DNA/ })[0];
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to a route from the sidebar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/' });

    await user.click(screen.getAllByRole('link', { name: /Trend Remix/ })[0] as HTMLElement);

    expect(await screen.findByRole('heading', { name: 'Trend Remix', level: 1 })).toBeInTheDocument();
  });

  it('shows a 404 page for an unknown route', () => {
    renderWithProviders(<App />, { route: '/does-not-exist' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('offers a skip link to the main content', () => {
    renderWithProviders(<App />, { route: '/' });
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).not.toBeNull();
  });

  it('shows who is signed in and signs them out', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/' });

    await user.click(screen.getAllByRole('button', { name: 'Sign out' })[0] as HTMLElement);

    expect(await screen.findByRole('heading', { name: 'CreatorDNA Studio' })).toBeInTheDocument();
  });
});

describe('auth gating', () => {
  afterEach(() => {
    signOutTestCreator();
  });

  it('sends an unauthenticated visitor to /login', () => {
    renderWithProviders(<App />, { route: '/dna' });

    // The login screen is the only place the "Continue as local creator" button
    // exists while Firebase is unconfigured.
    expect(screen.getByRole('button', { name: /local creator/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My DNA' })).toBeNull();
  });

  it('shows the login screen at /login and hides the app shell', () => {
    renderWithProviders(<App />, { route: '/login' });

    expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Create account' })).toBeInTheDocument();
  });
});

describe('HomePage', () => {
  const healthPayload = {
    status: 'ok',
    service: 'creatordna-api',
    version: '0.1.0',
    environment: 'development',
    uptimeSeconds: 12.5,
    timestamp: '2026-10-02T10:00:00.000Z',
    checks: { redis: 'ok', firebase: 'not_configured' },
  };

  beforeEach(() => {
    signInAsTestCreator();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(healthPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('shows a loading skeleton first, then the health data', async () => {
    renderWithProviders(<App />, { route: '/' });

    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByText('creatordna-api')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('12.5s')).toBeInTheDocument();
    expect(screen.getByText('redis')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows an error state with a retry when the API is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<App />, { route: '/' });

    // useHealth retries once with a backoff, so allow for that delay.
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent('Failed to fetch');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });
  });

  it('shows an empty state when the catalogue has nothing ranked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/trends/for-me')) {
          return new Response(
            JSON.stringify({ data: { trends: [], personalizationLimited: false } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify(healthPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderWithProviders(<App />, { route: '/' });

    expect(
      await screen.findByRole('heading', { name: 'No trends matched your DNA yet' }),
    ).toBeInTheDocument();
  });

  it('renders the trending carousel with relevance badges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/trends/for-me')) {
          return new Response(JSON.stringify({ data: trendList }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(healthPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderWithProviders(<App />, { route: '/' });

    expect(
      await screen.findByRole('heading', { name: 'Trending for you' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('POV: you finally understand {concept} after {time}'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Relevance to your DNA: 82%')).toBeInTheDocument();

    // The card links into the remix screen with the trend preselected.
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Remix this' })[0] as HTMLElement);
    expect(
      await screen.findByRole('heading', { name: 'Trend Remix', level: 1 }),
    ).toBeInTheDocument();
  });

  it('carries the typed idea into the Create screen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/' });

    await user.type(screen.getByLabelText('Your idea'), 'Binary search in 30 seconds');
    await user.click(screen.getByRole('button', { name: 'Start creating' }));

    expect(await screen.findByRole('heading', { name: 'Create', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Video idea')).toHaveValue('Binary search in 30 seconds');
  });

  it('prompts onboarding when the creator has no DNA yet', async () => {
    // /api/v1/dna answers 404 for a creator who has not onboarded.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/dna')) {
          return new Response(
            JSON.stringify({ error: { code: 'not_found', message: 'No Creator DNA yet' } }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify(healthPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderWithProviders(<App />, { route: '/' });

    expect(
      await screen.findByRole('heading', { name: 'Build your Creator DNA first' }),
    ).toBeInTheDocument();
  });
});

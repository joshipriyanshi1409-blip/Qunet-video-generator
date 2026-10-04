import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { useToastStore } from '../../store/useToastStore';

function mockFetchForStudio() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/v1/dna')) {
        return new Response(
          JSON.stringify({
            dna: {
              niche: 'Tech (CSE)',
              audienceAgeRange: '18-24',
              audienceType: 'Students',
              audience: ['Students'],
              tone: ['friendly', 'educational'],
              personality: ['clear'],
              format: 'short_video',
              style: 'Friendly - Educational',
              vocabulary: ['DSA'],
              catchphrases: ['Binary search in 30 seconds'],
              dos: ['use practical examples'],
              donts: ['dry theory dumps'],
              samplePosts: [],
              dnaVersion: 1,
            },
            score: { score: 87, missing: [], breakdown: {} },
            context: 'CREATOR DNA',
            contextTokens: 20,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: '@creatordna/api',
          version: '0.1.0',
          env: 'test',
          uptimeSec: 12,
          timestamp: '2026-04-17T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetchForStudio();
  useToastStore.getState().clear();
  signInAsTestCreator();
});

afterEach(() => {
  signOutTestCreator();
});

describe('PublishPage (Screen 9)', () => {
  it('renders the Ready to share on Qoneqt screen and publishes a preview post', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/publish?title=Binary+Search+Made+Easy' });

    expect(await screen.findByText('Ready to share on Qoneqt!')).toBeInTheDocument();
    expect(screen.getByText(/Binary Search Made Easy/)).toBeInTheDocument();

    const publishButton = screen.getByRole('button', { name: /Publish to Qoneqt/i });
    await user.click(publishButton);

    const matches = await screen.findAllByText(/Published to Qoneqt/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('SettingsPage (Screen 11)', () => {
  it('renders Devanshi Goyal profile and Creator DNA Summary cards', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/settings' });

    expect(await screen.findByText('Creator DNA Summary')).toBeInTheDocument();
    expect(screen.getAllByText('Devanshi Goyal').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Edit Profile/i }));
    expect(screen.getByLabelText(/Display Name/i)).toBeInTheDocument();
  });
});

describe('CreatePage', () => {
  it('renders the Create studio with prefilled prompt from query string', async () => {
    renderWithProviders(<App />, { route: '/create?prompt=Explain+Binary+Search' });

    expect(await screen.findByText('Creating your video...')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Explain Binary Search')).toBeInTheDocument();
  });
});

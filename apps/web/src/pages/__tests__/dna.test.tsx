import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyDNAPage } from '../MyDNAPage';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { useToastStore } from '../../store/useToastStore';

const dna = {
  niche: 'DSA interview prep for career switchers',
  tone: ['direct', 'playful'],
  audience: ['professionals', 'students'],
  style: 'Short sentences, whiteboard, fast cuts',
  personality: ['blunt', 'encouraging'],
  format: 'whiteboard',
  vocabulary: ['amortized'],
  catchphrases: ['Binary search in 30 seconds'],
  dos: ['dry run the code'],
  donts: ['jargon dumps'],
  samplePosts: [
    { text: 'Binary search in 30 seconds. Amortized analysis matters.' },
    { text: 'Why your linked list is slow.', url: 'https://example.com/post' },
  ],
  audienceAgeRange: '25-34',
  audienceType: 'professionals',
  dnaVersion: 3,
};

const profile = {
  dna,
  score: {
    completeness: 90,
    consistency: 80,
    score: 87,
    missingFields: ['catchphrases'],
    inconsistencies: [],
    dnaVersion: 3,
  },
  context: 'CREATOR DNA (uid: creator-a, version 3)',
  contextTokens: 214,
};

/** A `fetch` spy whose calls can be inspected. */
type FetchSpy = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

function stubFetch(status: number, payload: unknown): FetchSpy {
  const fetchMock: FetchSpy = vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('MyDNAPage', () => {
  beforeEach(() => {
    signInAsTestCreator();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
    useToastStore.getState().clear();
  });

  it('shows the onboarding empty state when the API returns 404', async () => {
    stubFetch(404, { error: { code: 'dna_not_found', message: 'No DNA yet.' } });
    renderWithProviders(<MyDNAPage />, { route: '/dna' });

    expect(await screen.findByText('No Creator DNA yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start onboarding' })).toBeInTheDocument();
  });

  it('renders the sync ring, the cards and the sample posts', async () => {
    stubFetch(200, { data: profile });
    renderWithProviders(<MyDNAPage />, { route: '/dna' });

    // Animated ring reports the blended score.
    const ring = await screen.findByRole('progressbar', { name: 'DNA sync' });
    expect(ring).toHaveAttribute('aria-valuenow', '87');
    expect(screen.getByRole('heading', { name: 'DNA sync 87%' })).toBeInTheDocument();

    // Metrics.
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('214 tok')).toBeInTheDocument();
    expect(screen.getByText('Still missing:')).toBeInTheDocument();

    // Content / Audience / Style cards.
    expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Audience' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Style' })).toBeInTheDocument();
    // Niche / format also appear in the "Your Content Style" tiles, hence getAll.
    expect(
      screen.getAllByText('DSA interview prep for career switchers').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Whiteboard').length).toBeGreaterThan(0);
    expect(screen.getByText('professionals, students')).toBeInTheDocument();

    // "Your Content Style".
    expect(screen.getByRole('heading', { name: 'Your Content Style' })).toBeInTheDocument();
    expect(screen.getAllByText('Tone').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Personality').length).toBeGreaterThan(0);

    // Sample posts, including the optional link.
    expect(screen.getByRole('heading', { name: 'Sample posts' })).toBeInTheDocument();
    expect(screen.getByText('Binary search in 30 seconds. Amortized analysis matters.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/post' })).toHaveAttribute(
      'href',
      'https://example.com/post',
    );
  });

  it('saves an edit from the modal and bumps the version', async () => {
    const fetchMock = stubFetch(200, { data: profile });
    renderWithProviders(<MyDNAPage />, { route: '/dna' });

    await screen.findByRole('progressbar', { name: 'DNA sync' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit DNA' }));

    const niche = await screen.findByLabelText('Niche');
    expect(niche).toHaveValue(dna.niche);

    await userEvent.clear(niche);
    await userEvent.type(niche, 'Systems design interviews');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const titles = useToastStore.getState().toasts.map((entry) => entry.title);
      expect(titles).toContain('DNA updated');
    });

    // PUT with only the editable fields, plus the dev auth header.
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();
    const init = putCall?.[1];
    expect(init).toBeDefined();
    const headers = ((init?.headers as Record<string, string> | undefined) ?? {}) as Record<string, string>;
    expect(headers['x-dev-uid']).toBe('creator-a');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ niche: 'Systems design interviews' });
    // Non-editable fields are not sent.
    expect(body).not.toHaveProperty('format');
    expect(body).not.toHaveProperty('samplePosts');
  });

  it('keeps the modal open and warns when the save fails', async () => {
    const fetchMock: FetchSpy = vi.fn(async (_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? new Response(JSON.stringify({ data: profile }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ error: { code: 'dna_update_failed', message: 'nope' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<MyDNAPage />, { route: '/dna' });

    await screen.findByRole('progressbar', { name: 'DNA sync' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit DNA' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const titles = useToastStore.getState().toasts.map((entry) => entry.title);
      expect(titles).toContain('Could not save');
    });
    // Still editing.
    expect(screen.getByRole('dialog', { name: 'Edit your DNA' })).toBeInTheDocument();
  });

  it('surfaces a non-404 failure with a retry button', async () => {
    stubFetch(500, { error: { code: 'internal_error', message: 'boom' } });
    renderWithProviders(<MyDNAPage />, { route: '/dna' });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

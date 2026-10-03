import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { OnboardingPage } from '../OnboardingPage';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { useToastStore } from '../../store/useToastStore';

const extractionResponse = {
  dna: {
    niche: 'DSA interview prep for career switchers',
    tone: ['direct', 'playful'],
    audience: ['professionals'],
    style: 'Short sentences, whiteboard, fast cuts',
    personality: ['blunt', 'encouraging'],
    format: 'whiteboard',
    vocabulary: ['amortized'],
    catchphrases: ['Binary search in 30 seconds'],
    dos: ['dry run the code'],
    donts: ['jargon dumps'],
    samplePosts: [{ text: 'Binary search in 30 seconds. Amortized analysis matters.' }],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
    dnaVersion: 1,
  },
  score: {
    completeness: 100,
    consistency: 100,
    score: 100,
    missingFields: [],
    inconsistencies: [],
    dnaVersion: 1,
  },
  context: 'CREATOR DNA (uid: creator-a, version 1)',
  contextTokens: 120,
  promptId: 'dna-extract',
  promptVersion: 1,
  reprompted: false,
  usage: {
    promptTokens: 400,
    completionTokens: 200,
    totalTokens: 600,
    model: 'gemini-text',
    usedFallback: false,
    durationMs: 1200,
  },
};

function stubFetch(status = 200, payload: unknown = extractionResponse) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Clicks Continue and waits for the next step's heading. The Motion exit
 * animation keeps the old step mounted briefly, so every transition has to be
 * awaited before the next query.
 */
async function continueTo(user: UserEvent, nextHeading: string) {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('heading', { name: nextHeading })).toBeInTheDocument();
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    signInAsTestCreator();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
    useToastStore.getState().clear();
  });

  it('starts on step 1 with the progress ring at 0%', () => {
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    expect(screen.getByRole('heading', { name: 'Your niche' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Onboarding progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('blocks Continue until the niche is filled in', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/niche/i);

    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    expect(button).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('walks through all five steps and submits', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    // 1 - niche
    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    await continueTo(user, 'Your audience');

    // 2 - audience
    await user.click(screen.getByRole('button', { name: '25-34' }));
    await user.click(screen.getByRole('button', { name: 'professionals' }));
    await continueTo(user, 'Your tone');

    // 3 - tone
    await user.click(screen.getByRole('button', { name: 'direct' }));
    await user.click(screen.getByRole('button', { name: 'playful' }));
    await continueTo(user, 'Your format');

    // 4 - format
    await user.click(screen.getByRole('button', { name: 'Whiteboard' }));
    await continueTo(user, 'Sample posts');

    // 5 - samples
    await user.type(
      screen.getByLabelText('Sample post 1'),
      'Binary search in 30 seconds. Amortized analysis matters.',
    );
    await user.click(screen.getByRole('button', { name: 'Build my DNA' }));

    // The extraction request carries everything the creator answered.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/dna/extract');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      niche: 'DSA interview prep',
      audienceAgeRange: '25-34',
      audienceType: 'professionals',
      tone: ['direct', 'playful'],
      format: 'whiteboard',
      samplePosts: [{ text: 'Binary search in 30 seconds. Amortized analysis matters.' }],
    });

    // Auth header: the dev bypass uid.
    const headers = (init.headers as Record<string, string>) ?? {};
    expect(headers['x-dev-uid']).toBe('creator-a');
  });

  it('reports the failure and stays on the wizard when extraction fails', async () => {
    const user = userEvent.setup();
    stubFetch(503, { error: { code: 'ai_unavailable', message: 'The model is unavailable.' } });
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    await continueTo(user, 'Your audience');
    await user.click(screen.getByRole('button', { name: '25-34' }));
    await continueTo(user, 'Your tone');
    await user.click(screen.getByRole('button', { name: 'direct' }));
    await continueTo(user, 'Your format');
    await user.click(screen.getByRole('button', { name: 'Whiteboard' }));
    await continueTo(user, 'Sample posts');
    await user.click(screen.getByRole('button', { name: 'Build my DNA' }));

    // The toast store holds the message (the viewport lives in AppLayout).
    await waitFor(() => {
      const titles = useToastStore.getState().toasts.map((entry) => entry.title);
      expect(titles).toContain('Could not build your DNA');
    });
    // Still on the wizard.
    expect(screen.getByRole('heading', { name: 'Sample posts' })).toBeInTheDocument();
  });

  it('lets the creator add a custom tone word and remove it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    await continueTo(user, 'Your audience');
    await user.click(screen.getByRole('button', { name: '25-34' }));
    await continueTo(user, 'Your tone');

    await user.type(screen.getByLabelText('Add your own word'), 'sardonic');
    await user.click(screen.getByRole('button', { name: 'Add word' }));

    const chip = screen.getByRole('button', { name: /Remove tone word sardonic/i });
    expect(chip).toBeInTheDocument();

    await user.click(chip);
    expect(screen.queryByRole('button', { name: /Remove tone word sardonic/i })).toBeNull();
  });

  it('caps tone words at six', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    await continueTo(user, 'Your audience');
    await user.click(screen.getByRole('button', { name: '25-34' }));
    await continueTo(user, 'Your tone');

    for (const word of ['direct', 'warm', 'playful', 'wry', 'calm', 'blunt']) {
      await user.click(screen.getByRole('button', { name: word }));
    }

    expect(screen.getByText('Your tone (6/6)')).toBeInTheDocument();
    // A seventh is ignored.
    await user.click(screen.getByRole('button', { name: 'technical' }));
    expect(screen.getByText('Your tone (6/6)')).toBeInTheDocument();
  });

  it('goes back without losing answers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    await continueTo(user, 'Your audience');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByLabelText('Niche')).toHaveValue('DSA interview prep');
  });

  it('adds and removes sample post rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    await user.type(screen.getByLabelText('Niche'), 'DSA interview prep');
    await continueTo(user, 'Your audience');
    await user.click(screen.getByRole('button', { name: '25-34' }));
    await continueTo(user, 'Your tone');
    await user.click(screen.getByRole('button', { name: 'direct' }));
    await continueTo(user, 'Your format');
    await user.click(screen.getByRole('button', { name: 'Whiteboard' }));
    await continueTo(user, 'Sample posts');

    expect(screen.getByLabelText('Sample post 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add another post' }));
    expect(screen.getByLabelText('Sample post 2')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1] as HTMLElement);
    expect(screen.queryByLabelText('Sample post 2')).toBeNull();
  });
});

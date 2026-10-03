import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HookLabPage } from '../HookLabPage';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { hooks, singleHook } from '../../test/trendsFixtures';
import { useUiStore } from '../../store/useUiStore';

const health = {
  service: 'creatordna-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 12,
  checks: {},
};

function stubFetch(options: { hooks?: unknown; status?: number } = {}): Mock<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/v1/trends/hooks')) {
      if (options.status !== undefined) {
        return new Response(
          JSON.stringify({ error: { code: 'ai_unavailable', message: 'The model is down.' } }),
          { status: options.status, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: { hooks: options.hooks ?? hooks } }), {
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
  return mock;
}

describe('HookLabPage', () => {
  beforeEach(() => {
    signInAsTestCreator();
    // The draft idea deliberately survives a navigation, so clear it here.
    useUiStore.setState({ draftIdea: '' });
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('writes six hooks in distinct styles', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));

    expect(await screen.findAllByRole('listitem')).toHaveLength(6);

    for (const label of ['Question', 'Bold claim', 'POV', 'Story', 'Contrarian', 'Curiosity gap']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('lets the creator select one hook', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));

    const radios = await screen.findAllByRole('radio');
    await user.click(radios[0] as HTMLElement);

    expect(await screen.findByText('Selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this hook' })).toBeInTheDocument();
  });

  it('edits a hook inline', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));
    await screen.findByText('Why does your binary search never terminate?');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);

    const textarea = screen.getByLabelText('Edit the Question hook');
    await user.clear(textarea);
    await user.type(textarea, 'Why does binary search still feel impossible?');

    await user.click(screen.getAllByRole('button', { name: 'Done' })[0] as HTMLElement);
    expect(screen.getByText('Why does binary search still feel impossible?')).toBeInTheDocument();
  });

  it('regenerates a single style without touching the others', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));
    await screen.findByText('The bug is never in the loop.');

    const regenerateButtons = screen.getAllByRole('button', { name: 'Regenerate this style' });
    await user.click(regenerateButtons[regenerateButtons.length - 1] as HTMLElement);

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(posts).toHaveLength(2);
    });

    // The second request asks for exactly one style.
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts[1]?.[1]?.body).toContain('regenerateStyle');
    expect(posts[1]?.[1]?.body).toContain('curiosity-gap');
  });

  it('shows only the regenerated hook when the API answers with one', async () => {
    stubFetch({ hooks: singleHook });
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });

  it('shows an error state with a retry when the model fails', async () => {
    stubFetch({ status: 503 });
    const user = userEvent.setup();
    renderWithProviders(<HookLabPage />);

    await user.type(screen.getByLabelText('Your idea'), 'Explain binary search');
    await user.click(screen.getByRole('button', { name: 'Write hooks' }));

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent('The model is down.');
  });

  it('shows an empty state before anything is generated', () => {
    stubFetch();
    renderWithProviders(<HookLabPage />);
    expect(screen.getByRole('heading', { name: 'No hooks yet' })).toBeInTheDocument();
  });

  it('refuses to generate without an idea', () => {
    const fetchMock = stubFetch();
    renderWithProviders(<HookLabPage />);

    expect(screen.getByRole('button', { name: 'Write hooks' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

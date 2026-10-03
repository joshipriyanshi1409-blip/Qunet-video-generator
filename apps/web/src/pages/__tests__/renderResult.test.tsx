import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { RenderResultPage } from '../RenderResultPage';

/**
 * The result screen.
 *
 * `fetch` and `URL.createObjectURL` are stubbed. The share button is checked
 * against the mock adapter, which is what runs today: the UI must show the post
 * id it got back and must not claim the video was published.
 */

const JOB_ID = 'job_7';

function completedJob(): Record<string, unknown> {
  return {
    jobId: JOB_ID,
    name: 'render-video',
    state: 'completed',
    progress: 100,
    attemptsMade: 1,
    failedReason: null,
    returnvalue: null,
    data: {
      projectId: 'proj_1',
      hook: 'POV: binary search finally clicks',
      caption: 'Three days, one bug, zero progress.',
      hashtags: ['#dsa', '#careerswitch'],
      cta: 'Follow for part two',
      script: [
        { scene: 'Scene 1', text: 'I wrote the same loop nine times.' },
        { scene: 'Scene 2', text: 'Then I drew the array.' },
      ],
    },
    stage: 'completed',
    assets: [
      { kind: 'captions', storagePath: 'renders/u/job_7/captions.vtt', url: 'https://x/captions.vtt' },
      { kind: 'mp4', storagePath: 'renders/u/job_7/final.mp4', url: 'https://x/final.mp4' },
    ],
    error: null,
  };
}

function stubJob(payload: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/api/v1/render/${JOB_ID}`)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // The MP4 download: a blob of bytes the page can hand to the browser.
      return new Response('video-bytes', {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }),
  );
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/render/${JOB_ID}/result`]}>
      <Routes>
        <Route path="/render/:jobId/result" element={<RenderResultPage />} />
        <Route path="/render/:jobId" element={<p>progress screen</p>} />
        <Route path="/library" element={<p>library screen</p>} />
      </Routes>
    </MemoryRouter>,
    { withRouter: false },
  );
}

describe('RenderResultPage', () => {
  beforeEach(() => {
    signInAsTestCreator();
    localStorage.clear();
    // `URL.createObjectURL` is shimmed in `src/test/setup.ts`; jsdom has none.
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('plays the MP4 with its captions track', async () => {
    stubJob(completedJob());

    renderPage();

    const video = await screen.findByLabelText(
      'Finished short: POV: binary search finally clicks',
    );
    expect(video.tagName).toBe('VIDEO');
    const track = video.querySelector('track');
    expect(track).toHaveAttribute('src', 'https://x/captions.vtt');
    expect(track).toHaveAttribute('kind', 'captions');
  });

  it('offers a copy button for the caption and for every hashtag', async () => {
    stubJob(completedJob());

    renderPage();

    expect(await screen.findByRole('button', { name: 'Copy caption' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy hashtags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy #dsa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy #careerswitch' })).toBeInTheDocument();
  });

  it('writes the job into the library on first load', async () => {
    stubJob(completedJob());

    renderPage();

    await screen.findByText('Your video is ready');

    const stored = JSON.parse(localStorage.getItem('creatordna.library.v1') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ jobId: JOB_ID, state: 'completed', title: 'POV: binary search finally clicks' });
    // The script is saved with the entry, so the library survives a page reload
    // without a second fetch.
    expect(stored[0].script).toContain('I wrote the same loop nine times.');
  });

  it('downloads the MP4 as a file named after the title', async () => {
    stubJob(completedJob());

    // `downloadBlob` builds a throwaway anchor and clicks it. The spy's
    // `instances` holds the element it was called on, which is the only way to
    // see the filename the creator would get. The cast is needed because
    // `click()` returns void, so vitest types `instances` as void.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Download MP4' }));

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled());
    // The filename comes from the hook, so the creator can tell renders apart in
    // their downloads folder without opening each one.
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement | undefined;
    expect(anchor?.download).toBe('pov-binary-search-finally-clicks-job_7.mp4');
    clickSpy.mockRestore();
  });

  it('says nothing was published when sharing through the mock adapter', async () => {
    stubJob(completedJob());

    renderPage();
    const button = await screen.findByRole('button', { name: 'Share to Qoneqt' });
    button.click();

    // The card's own line, not the toast: this is the part that stays on screen.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Shared in preview mode. Nothing has been published to the real feed.',
    );
    expect(screen.getByRole('button', { name: 'In your library' })).toBeDisabled();
  });

  it('points a job that is still rendering back at its progress screen', async () => {
    stubJob({ ...completedJob(), state: 'active', stage: 'voice', progress: 62 });

    renderPage();

    expect(await screen.findByText('Still rendering')).toBeInTheDocument();
    // Matched as a regex: the sentence is assembled from several text nodes.
    expect(screen.getByText(/on the voice stage at 62%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share to Qoneqt' })).toBeNull();
  });

  it('explains a finished job that has no MP4 on the record', async () => {
    stubJob({ ...completedJob(), assets: [] });

    renderPage();

    expect(await screen.findByText('No video recorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download MP4' })).toBeDisabled();
  });

  it('has no render selected when the route carries no job id', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/render/result']}>
        <Routes>
          <Route path="/render/result" element={<RenderResultPage />} />
        </Routes>
      </MemoryRouter>,
      { withRouter: false },
    );

    expect(screen.getByText('No render selected')).toBeInTheDocument();
  });
});

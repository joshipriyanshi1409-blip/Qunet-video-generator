import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { signInAsTestCreator, signOutTestCreator } from '../../test/auth';
import { RenderProgressPage } from '../RenderProgressPage';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The render progress screen.
 *
 * `fetch` is stubbed at the job-document endpoint, and the WebSocket is stubbed
 * out entirely: jsdom has no WebSocket implementation that would survive the
 * handshake, and what these tests are about is what the screen does with the
 * data - the stepper, the bar, the retry, the honest empty and error states.
 */

const JOB_ID = 'job_42';

function jobPayload(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID,
    name: 'render-video',
    state: 'active',
    progress: 40,
    attemptsMade: 1,
    failedReason: null,
    returnvalue: null,
    data: { projectId: 'proj_1', hook: 'POV: binary search finally clicks' },
    stage: 'assets',
    assets: [{ kind: 'clip', storagePath: 'renders/u/job_42/scene-0.mp4', sceneIndex: 0 }],
    error: null,
    ...overrides,
  };
}

function stubJob(payload: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/api/v1/render/${JOB_ID}`) || url.includes(`/api/v1/jobs/${JOB_ID}`)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

/** Renders the page at `/render/:jobId`, with a route for the result screen. */
function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/render/${JOB_ID}`]}>
      <Routes>
        <Route path="/render/:jobId" element={<RenderProgressPage />} />
        <Route path="/render/:jobId/result" element={<p>result screen</p>} />
        <Route path="/library" element={<p>library screen</p>} />
      </Routes>
    </MemoryRouter>,
    { withRouter: false },
  );
}

describe('RenderProgressPage', () => {
  beforeEach(() => {
    signInAsTestCreator();
  });

  afterEach(() => {
    signOutTestCreator();
    vi.unstubAllGlobals();
  });

  it('shows the stage the job is on and the progress bar', async () => {
    stubJob(jobPayload());

    renderPage();

    expect(await screen.findByRole('progressbar', { name: 'Overall render progress' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(screen.getByRole('progressbar', { name: 'Render progress' })).toBeInTheDocument();
    expect(screen.getByText('Generating visuals')).toBeInTheDocument();
  });

  it('marks the current step in the stepper', async () => {
    stubJob(jobPayload({ stage: 'voice', progress: 50 }));

    renderPage();

    await screen.findByText('Recording the voice-over');
    const steps = screen.getAllByRole('listitem');
    const current = steps.find((step) => step.querySelector('[aria-current="step"]') !== null);
    expect(current).toHaveTextContent('Voice');
  });

  it('shows an ETA that says it is still estimating', async () => {
    stubJob(jobPayload());
    renderPage();

    // A job that has just loaded has no measured rate yet, and the screen says
    // so rather than inventing a number.
    expect(await screen.findByTestId('render-eta')).toHaveTextContent('Estimating…');
  });

  it('explains what failed and what a retry will not redo', async () => {
    stubJob(
      jobPayload({
        state: 'failed',
        stage: 'voice',
        progress: 45,
        failedReason: 'TTS timeout',
        error: { stage: 'voice', message: 'TTS timeout', attempts: 1, retryable: true },
      }),
    );

    renderPage();

    expect(await screen.findByText('The voice stage failed')).toBeInTheDocument();
    expect(screen.getByText(/Assets already on the job are kept/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry this stage' })).toBeInTheDocument();
  });

  it('offers a link to the result once the job is finished with an MP4', async () => {
    stubJob(
      jobPayload({
        state: 'completed',
        stage: 'completed',
        progress: 100,
        assets: [{ kind: 'mp4', storagePath: 'renders/u/job_42/final.mp4', url: 'https://x/final.mp4' }],
      }),
    );

    renderPage();

    const button = await screen.findByRole('button', { name: 'View result' });
    expect(button).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop following' })).toBeNull();
  });

  it('says so plainly when a finished job has no MP4', async () => {
    stubJob(jobPayload({ state: 'completed', stage: 'completed', progress: 100 }));

    renderPage();

    expect(await screen.findByText('Finished, but no video yet')).toBeInTheDocument();
  });

  it('shows a skeleton while the read is in flight, not a fake progress bar', async () => {
    // The fetch never settles here on purpose: the point is what the screen
    // shows while it knows nothing, and a zeroed progress bar would be a lie.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    renderPage();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('explains a 503 as the queue being off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'service_unavailable', message: 'queue unavailable' } }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('queue unavailable');
    expect(screen.getByText(/Start Redis and restart the API/)).toBeInTheDocument();
  });

  it('shows an empty state when no job is selected', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/render/']}>
        <Routes>
          <Route path="/render/" element={<RenderProgressPage />} />
        </Routes>
      </MemoryRouter>,
      { withRouter: false },
    );

    expect(screen.getByText('No render selected')).toBeInTheDocument();
  });
});

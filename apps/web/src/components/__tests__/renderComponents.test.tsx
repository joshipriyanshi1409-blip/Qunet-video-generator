import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { DnaRing } from '../DnaRing';
import { ProgressBar } from '../ProgressBar';
import { StageStepper } from '../render/StageStepper';
import { EtaBadge } from '../render/EtaBadge';
import { RenderActions } from '../render/RenderActions';

/**
 * The render chrome.
 *
 * These are the pieces a creator stares at for a minute, so the tests are about
 * what they *say* rather than how they look: the current step is announced, the
 * progress bar exposes a value, and a button that cannot do anything is not
 * offered.
 */

describe('ProgressBar', () => {
  it('exposes a value to assistive tech', () => {
    renderWithProviders(<ProgressBar value={42} label="Render progress" />);

    const bar = screen.getByRole('progressbar', { name: 'Render progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps a value outside 0-100', () => {
    renderWithProviders(<ProgressBar value={180} label="Render progress" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    renderWithProviders(<ProgressBar value={-20} label="Render progress" />);
    expect(screen.getAllByRole('progressbar')[1]).toHaveAttribute('aria-valuenow', '0');
  });

  it('hides the number when asked', () => {
    renderWithProviders(<ProgressBar value={50} label="Render progress" showValue={false} />);
    expect(screen.queryByText('50%')).toBeNull();
  });
});

describe('DnaRing', () => {
  it('reports the final value even though it animates up to it', () => {
    renderWithProviders(<DnaRing value={82} />);

    // `aria-valuenow` is the value, not the animation frame: a screen reader
    // should hear the score, not whatever the ring happens to be showing.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '82');
  });

  it('labels itself for assistive tech', () => {
    renderWithProviders(<DnaRing value={50} label="DNA sync score" />);
    expect(screen.getByRole('progressbar', { name: 'DNA sync score' })).toBeInTheDocument();
  });
});

describe('StageStepper', () => {
  it('marks the current step with aria-current', () => {
    renderWithProviders(<StageStepper currentIndex={2} progress={50} failed={false} />);

    // `renderWithProviders` mounts a fresh router per call, so scope the query to
    // this render's list rather than every listitem on the page.
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(7);
    const current = steps[2];
    expect(current?.querySelector('[aria-current="step"]')).not.toBeNull();
    expect(current).toHaveTextContent('Voice');
  });

  it('shows every step in order', () => {
    renderWithProviders(<StageStepper currentIndex={0} progress={0} failed={false} />);

    const steps = screen.getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Script'),
      expect.stringContaining('Visuals'),
      expect.stringContaining('Voice'),
      expect.stringContaining('Music'),
      expect.stringContaining('Captions'),
      expect.stringContaining('Compose'),
      expect.stringContaining('QC'),
    ]);
  });

  it('marks earlier steps done and later ones pending', () => {
    renderWithProviders(<StageStepper currentIndex={3} progress={50} failed={false} />);

    // Three done, one running, three waiting - the counts are the assertion,
    // because "Done" appears once per finished step.
    expect(screen.getAllByText('Done')).toHaveLength(3);
    expect(screen.getAllByText('Waiting')).toHaveLength(3);
    expect(screen.getAllByText('Running')).toHaveLength(1);
  });

  it('marks the current step failed when the job failed', () => {
    renderWithProviders(<StageStepper currentIndex={2} progress={45} failed />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    // The steps before the failure still did their work.
    expect(screen.getAllByText('Done')).toHaveLength(2);
  });
});

describe('EtaBadge', () => {
  it('shows the estimate when there is one', () => {
    renderWithProviders(<EtaBadge estimate={{ seconds: 42, reason: 'done' }} />);
    expect(screen.getByTestId('render-eta')).toHaveTextContent('about 42s left');
  });

  it('explains itself when it cannot estimate yet', () => {
    renderWithProviders(<EtaBadge estimate={{ seconds: null, reason: 'warming-up' }} />);
    expect(screen.getByTestId('render-eta')).toHaveTextContent('Estimating…');
    expect(screen.getByText(/first stage reports in/)).toBeInTheDocument();
  });

  it('says a stall is normal rather than an error', () => {
    renderWithProviders(<EtaBadge estimate={{ seconds: null, reason: 'stalled' }} />);
    expect(screen.getByText(/while a clip renders/)).toBeInTheDocument();
  });
});

describe('RenderActions', () => {
  it('offers a retry for a failed job', () => {
    renderWithProviders(
      <RenderActions
        finished={false}
        failed
        retrying={false}
        cancelled={false}
        onRetry={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry this stage' })).toBeInTheDocument();
    expect(screen.getByText(/Only the failed stage runs again/)).toBeInTheDocument();
  });

  it('offers nothing to cancel or retry once the job is finished', () => {
    renderWithProviders(
      <RenderActions
        finished
        failed={false}
        retrying={false}
        cancelled={false}
        onRetry={() => {}}
        onCancel={() => {}}
        onViewResult={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry this stage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop following' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View result' })).toBeInTheDocument();
  });

  it('says plainly that stopping is local', () => {
    renderWithProviders(
      <RenderActions
        finished={false}
        failed={false}
        retrying={false}
        cancelled
        onRetry={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Stopped following' })).toBeDisabled();
    expect(screen.getByText(/The worker keeps going/)).toBeInTheDocument();
  });

  it('shows a spinner while retrying', () => {
    renderWithProviders(
      <RenderActions
        finished={false}
        failed
        retrying
        cancelled={false}
        onRetry={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});

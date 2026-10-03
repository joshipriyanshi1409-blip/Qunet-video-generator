import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { coachTipSchema } from '@creatordna/shared';
import { FeedbackFeed } from '../voiceCoach/FeedbackFeed';
import { ScriptTeleprompter } from '../voiceCoach/ScriptTeleprompter';
import { SessionTimer } from '../voiceCoach/SessionTimer';
import { Waveform } from '../voiceCoach/Waveform';

/**
 * The coach's four view components.
 *
 * These are the parts a creator is looking at while talking, so the tests are
 * about legibility under pressure: the current line is findable, the newest tip
 * is first, and the clock says how long is left rather than how long has gone.
 */

describe('ScriptTeleprompter', () => {
  const script = ['First line', 'Second line', 'Third line'];

  it('marks the current line for assistive technology', () => {
    render(<ScriptTeleprompter script={script} currentLine={1} />);

    const current = screen.getByText('Second line');
    expect(current.closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('First line').closest('li')).not.toHaveAttribute('aria-current');
  });

  it('lets the creator jump to a line by clicking it', async () => {
    const user = userEvent.setup();
    const chosen: number[] = [];

    render(
      <ScriptTeleprompter script={script} currentLine={0} onSelectLine={(index) => chosen.push(index)} />,
    );

    await user.click(screen.getByRole('button', { name: /Read line 3/ }));

    expect(chosen).toEqual([2]);
  });

  it('clamps an out-of-range line instead of highlighting nothing', () => {
    render(<ScriptTeleprompter script={script} currentLine={99} />);

    expect(screen.getByText('Third line').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('renders no buttons when the line is not selectable', () => {
    render(<ScriptTeleprompter script={script} currentLine={0} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FeedbackFeed', () => {
  const tip = coachTipSchema.parse({ kind: 'filler', severity: 'warning', message: 'Two ums.' });

  it('shows the newest tip first, because that is the one still actionable', () => {
    const older = coachTipSchema.parse({ kind: 'pace', severity: 'info', message: 'Slow down.' });

    render(<FeedbackFeed tips={[older, tip]} transcript="" />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Two ums.');
    expect(items[1]).toHaveTextContent('Slow down.');
  });

  it('labels the kind and the severity of each tip', () => {
    render(<FeedbackFeed tips={[tip]} transcript="" />);

    expect(screen.getByText('Filler words')).toBeInTheDocument();
    expect(screen.getByText('Fix')).toBeInTheDocument();
  });

  it('says so when there is nothing to coach yet', () => {
    render(<FeedbackFeed tips={[]} transcript="" />);

    expect(screen.getByText(/No tips yet/)).toBeInTheDocument();
  });

  it('shows the interim transcript as a live region', () => {
    render(<FeedbackFeed tips={[]} transcript="Reconnecting…" />);

    expect(screen.getByText('Reconnecting…')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the tip list a live region', () => {
    render(<FeedbackFeed tips={[tip]} transcript="" />);

    expect(screen.getByRole('list', { name: 'Live coaching tips' })).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });
});

describe('SessionTimer', () => {
  it('counts down from the per-session maximum', () => {
    render(<SessionTimer elapsedSeconds={120} remainingSeconds={180} />);

    expect(screen.getByRole('timer')).toHaveTextContent('3:00');
  });

  it('reports progress as a percentage of the budget used', () => {
    render(<SessionTimer elapsedSeconds={150} remainingSeconds={150} />);

    expect(screen.getByRole('progressbar', { name: 'Session time used' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
  });

  it('tells a screen reader how long is left', () => {
    render(<SessionTimer elapsedSeconds={0} remainingSeconds={42} />);

    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '42 seconds left in this session');
  });
});

describe('Waveform', () => {
  it('announces whether the microphone is live', () => {
    const { rerender } = render(<Waveform level={0} active={false} />);
    expect(screen.getByRole('img', { name: 'Microphone is off' })).toBeInTheDocument();

    rerender(<Waveform level={0.5} active />);
    expect(screen.getByRole('img', { name: 'Microphone is live' })).toBeInTheDocument();
  });

  it('draws the same number of bars every frame', () => {
    render(<Waveform level={0.9} active />);

    expect(screen.getByRole('img').children).toHaveLength(28);
  });
});

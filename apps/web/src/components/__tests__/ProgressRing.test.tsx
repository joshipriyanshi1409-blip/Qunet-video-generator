import { describe, expect, it } from 'vitest';
import {render, screen} from '@testing-library/react';
import { ProgressRing } from '../ProgressRing';

describe('ProgressRing', () => {
  it('exposes progressbar semantics', () => {
    render(<ProgressRing value={42} label="DNA sync" />);

    const ring = screen.getByRole('progressbar', { name: 'DNA sync' });
    expect(ring).toHaveAttribute('aria-valuenow', '42');
    expect(ring).toHaveAttribute('aria-valuemin', '0');
    expect(ring).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('clamps values outside 0-100', () => {
    const { rerender } = render(<ProgressRing value={-20} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    rerender(<ProgressRing value={180} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('treats a non-finite value as 0', () => {
    render(<ProgressRing value={Number.NaN} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('can hide the numeric label', () => {
    render(<ProgressRing value={70} hideValue />);
    expect(screen.queryByText('70%')).toBeNull();
  });

  it('draws a dash offset that matches the value', () => {
    const { container } = render(<ProgressRing value={50} size={100} thickness={10} />);
    const circles = container.querySelectorAll('circle');
    const track = circles[0];
    const indicator = circles[1];
    expect(track).toBeDefined();
    expect(indicator).toBeDefined();

    // radius = (100 - 10) / 2 = 45 -> circumference ~282.74 -> offset ~141.37
    const circumference = 2 * Math.PI * 45;
    expect(Number(indicator?.getAttribute('stroke-dasharray'))).toBeCloseTo(circumference, 1);
    expect(Number(indicator?.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference / 2, 1);
  });
});

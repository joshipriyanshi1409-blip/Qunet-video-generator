import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, ReactionBadge } from '../Badge';

describe('Badge', () => {
  it('renders tone classes', () => {
    const { container } = render(<Badge tone="success">online</Badge>);
    expect(screen.getByText('online')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('bg-success-soft');
  });

  it('uppercases compact badges', () => {
    const { container } = render(<Badge compact>stage</Badge>);
    expect(container.firstElementChild?.className).toContain('uppercase');
  });
});

describe('ReactionBadge', () => {
  it('labels each reaction level for assistive tech', () => {
    render(
      <>
        <ReactionBadge level="high" />
        <ReactionBadge level="medium" />
        <ReactionBadge level="low" />
      </>,
    );

    expect(screen.getByLabelText('Predicted reaction: High')).toBeInTheDocument();
    expect(screen.getByLabelText('Predicted reaction: Medium')).toBeInTheDocument();
    expect(screen.getByLabelText('Predicted reaction: Low')).toBeInTheDocument();
  });

  it('maps reaction levels to the right tones', () => {
    const { container } = render(<ReactionBadge level="high" />);
    expect(container.firstElementChild?.className).toContain('bg-success-soft');
  });
});

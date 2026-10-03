import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

describe('Button', () => {
  it('renders its label and handles clicks', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Button onClick={onClick}>Generate</Button>);

    const button = screen.getByRole('button', { name: 'Generate' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('applies variant and size classes', () => {
    const { container: secondary } = render(
      <Button variant="secondary" size="lg">
        Save
      </Button>,
    );
    const secondaryButton = secondary.querySelector('button');
    expect(secondaryButton?.className).toContain('bg-surface');
    expect(secondaryButton?.className).toContain('border-line');
    expect(secondaryButton?.className).toContain('h-12');
    expect(secondaryButton?.className).not.toContain('bg-peach-500');
  });

  it('applies the primary variant classes', () => {
    const { container } = render(<Button>Generate</Button>);
    expect(container.querySelector('button')?.className).toContain('bg-peach-500');
  });

  it('shows a spinner and blocks interaction while loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Button loading onClick={onClick}>
        Rendering
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Rendering' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-testid="button-spinner"]')).not.toBeNull();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('supports icon-only buttons with an accessible name', () => {
    render(
      <Button iconOnly aria-label="Open navigation">
        <svg />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveClass('w-10', 'px-0');
  });

  it('renders as a submit button when asked', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit');
  });
});

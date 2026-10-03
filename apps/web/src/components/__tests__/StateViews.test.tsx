import { describe, expect, it, vi } from 'vitest';
import {render, screen} from '@testing-library/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from '../StateViews';
import { ApiError } from '../../lib/api';
import { createTestQueryClient, renderWithProviders } from '../../test/utils';

describe('LoadingState', () => {
  it('announces itself politely', () => {
    render(<LoadingState label="Loading trends…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading trends…');
  });
});

describe('EmptyState', () => {
  it('explains how to get started and renders an action', () => {
    render(
      <EmptyState
        title="No trends yet"
        description="Set your niche first."
        action={<button type="button">Browse</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No trends yet' })).toBeInTheDocument();
    expect(screen.getByText('Set your niche first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('shows the API error message and a retry button', async () => {
    const onRetry = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');

    render(<ErrorState error={new ApiError(503, 'service_unavailable', 'Redis is down')} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Redis is down');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('falls back to a generic message for unknown errors', () => {
    render(<ErrorState error="boom" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });
});

describe('QueryBoundary', () => {
  it('renders the loading state while pending', () => {
    function Pending() {
      const query = { isPending: true, isError: false, data: undefined, refetch: vi.fn() } as unknown as UseQueryResult<string>;
      return (
        <QueryBoundary query={query} loadingLabel="Loading hooks…">
          {() => <p>loaded</p>}
        </QueryBoundary>
      );
    }

    render(<Pending />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading hooks…');
    expect(screen.queryByText('loaded')).toBeNull();
  });

  it('renders the error state with a retry', async () => {
    const refetch = vi.fn();
    function Failed() {
      const query = {
        isPending: false,
        isError: true,
        error: new Error('network down'),
        data: undefined,
        refetch,
      } as unknown as UseQueryResult<string>;
      return (
        <QueryBoundary query={query}>{() => <p>loaded</p>}</QueryBoundary>
      );
    }

    const user = (await import('@testing-library/user-event')).default;
    render(<Failed />);
    expect(screen.getByRole('alert')).toHaveTextContent('network down');
    await user.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders the empty state when isEmpty matches', () => {
    function Empty() {
      const query = {
        isPending: false,
        isError: false,
        data: [],
        refetch: vi.fn(),
      } as unknown as UseQueryResult<string[]>;
      return (
        <QueryBoundary
          query={query}
          isEmpty={(data) => data.length === 0}
          emptyTitle="No hooks yet"
        >
          {() => <p>loaded</p>}
        </QueryBoundary>
      );
    }

    render(<Empty />);
    expect(screen.getByRole('heading', { name: 'No hooks yet' })).toBeInTheDocument();
  });

  it('renders the success state with data', () => {
    function Success() {
      const query = {
        isPending: false,
        isError: false,
        data: ['hook one'],
        refetch: vi.fn(),
      } as unknown as UseQueryResult<string[]>;
      return (
        <QueryBoundary query={query} isEmpty={(data) => data.length === 0}>
          {(data) => <p>{data.join(', ')}</p>}
        </QueryBoundary>
      );
    }

    render(<Success />);
    expect(screen.getByText('hook one')).toBeInTheDocument();
  });

  it('works with a real TanStack query result', async () => {
    const client = createTestQueryClient();

    function Real() {
      const query = useQuery({ queryKey: ['real'], queryFn: async () => ['a', 'b'], retry: false });
      return (
        <QueryBoundary query={query} isEmpty={(data) => data.length === 0}>
          {(data) => <p>count: {data.length}</p>}
        </QueryBoundary>
      );
    }

    renderWithProviders(<Real />, { queryClient: client });
    expect(await screen.findByText('count: 2')).toBeInTheDocument();
  });
});

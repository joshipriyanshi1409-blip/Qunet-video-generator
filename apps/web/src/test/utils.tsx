import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  queryClient?: QueryClient;
  /**
   * Skip the built-in `MemoryRouter`.
   *
   * Set this when the component under test brings its own routes (a page with
   * `<Routes>` inside), because nesting two routers is an error, not a warning.
   */
  withRouter?: boolean;
}

export type RenderWithProvidersResult = RenderResult & { queryClient: QueryClient };

/** Fresh QueryClient per test so cached state never leaks between cases. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    queryClient = createTestQueryClient(),
    withRouter = true,
    ...options
  }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return withRouter === true ? (
      <MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>
    ) : (
      tree
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

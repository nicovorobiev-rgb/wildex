/**
 * lib/queryClient.ts — React Query client factory (R3.4)
 *
 * Dependency rules (spec/architecture.md §2, §9):
 *   lib/ may NOT import from hooks/, services/, app/, components/.
 *   This file imports only from @tanstack/react-query.
 *
 * Usage:
 *   // app/_layout.tsx (one instance per app lifetime):
 *   const queryClient = createQueryClient();
 *
 *   // __tests__/someHook.test.ts (one instance per test):
 *   const queryClient = createQueryClient();
 *   const wrapper = ({ children }) => (
 *     <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
 *   );
 *
 * One client per app:
 *   Create exactly one QueryClient at mount-time (outside the component tree,
 *   or in a useState initializer so it is stable across re-renders).
 *   Sharing one client across the whole app is the intended pattern — it gives
 *   you a unified cache, deduped in-flight requests, and consistent stale/gc
 *   behavior everywhere.
 *
 * One client per test:
 *   Each test should create its own QueryClient so cache state cannot leak
 *   between tests. Pass it as a prop to QueryClientProvider in the test wrapper.
 *   Call queryClient.clear() in afterEach if multiple tests share one instance.
 *
 * TODO(R6): replace the console.error error handler with a real telemetry call
 * (e.g. Sentry.captureException) once the telemetry layer is wired up.
 */

import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Default options (spec/architecture.md §5)
// ---------------------------------------------------------------------------

/** staleTime: data is considered fresh for 30 s before a background refetch. */
const DEFAULT_STALE_TIME = 30_000;

/** gcTime: unused cache entries are garbage-collected after 5 min. */
const DEFAULT_GC_TIME = 5 * 60_000;

/** Queries retry once on failure (network blip tolerance). */
const QUERY_RETRY = 1;

/** Mutations do not retry — user-initiated writes should fail fast. */
const MUTATION_RETRY = 0;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a new, configured QueryClient.
 *
 * Call once at app mount time and pass to <QueryClientProvider>.
 * Call once per test file (or per test) to avoid cross-test cache pollution.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      // TODO(R6): replace with Sentry.captureException or equivalent telemetry.
      onError: (error, query) => {
        console.error('[QueryCache] query error', { queryKey: query.queryKey, error });
      },
    }),
    mutationCache: new MutationCache({
      // TODO(R6): replace with Sentry.captureException or equivalent telemetry.
      onError: (error, _variables, _context, mutation) => {
        console.error('[MutationCache] mutation error', {
          mutationKey: mutation.options.mutationKey,
          error,
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        gcTime: DEFAULT_GC_TIME,
        retry: QUERY_RETRY,
      },
      mutations: {
        retry: MUTATION_RETRY,
      },
    },
  });
}

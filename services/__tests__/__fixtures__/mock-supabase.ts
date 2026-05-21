/**
 * services/__tests__/__fixtures__/mock-supabase.ts
 *
 * Reusable chainable Supabase mock factory for service-layer integration tests.
 *
 * Design goals:
 *   - Zero shared mutable state between tests — call createMockSupabase() fresh
 *     inside each test or beforeEach block.
 *   - Chainable query builder (mirrors the fluent Supabase client API).
 *   - Configurable terminal result: set dbResult / storageResult / fnResult
 *     before the code-under-test runs, then await the chain.
 *   - All jest.fn() spies are exposed so callers can assert call args.
 */

// ---------------------------------------------------------------------------
// Types for configuring mock responses
// ---------------------------------------------------------------------------

export interface MockDbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

export interface MockStorageResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

export interface MockFnResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

export interface MockAuthResult {
  data: { user: { id: string } | null };
  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Query builder — chainable, resolves to a MockDbResult on await
// ---------------------------------------------------------------------------

/**
 * Returns an object that is both thenable (Promise-like) and exposes every
 * query-builder method the service layer calls. Each method returns `this`
 * for chaining. The spy on each method is stored on the builder so tests can
 * assert `.from('foo').select.mock.calls`.
 *
 * The builder resolves to `{ data, error }` once awaited.
 */
export function buildQueryChain(result: MockDbResult) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockReturnThis(),
    // Thenable so `await chain` resolves to { data, error }
    then: (onFulfilled: (v: MockDbResult) => unknown) => Promise.resolve(result).then(onFulfilled),
  };

  // Ensure .single() and .maybeSingle() also resolve to the same result
  // (they are no-ops in the mock — the chain is already thenable).
  chain.single.mockReturnValue(chain);
  chain.maybeSingle.mockReturnValue(chain);

  return chain;
}

// ---------------------------------------------------------------------------
// Storage mock
// ---------------------------------------------------------------------------

function buildStorageMock(result: MockStorageResult) {
  const bucket = {
    createSignedUrl: jest.fn().mockResolvedValue(result),
  };
  return {
    from: jest.fn().mockReturnValue(bucket),
    _bucket: bucket,
  };
}

// ---------------------------------------------------------------------------
// Auth mock
// ---------------------------------------------------------------------------

function buildAuthMock(authResult: MockAuthResult) {
  return {
    getUser: jest.fn().mockResolvedValue(authResult),
  };
}

// ---------------------------------------------------------------------------
// Functions (Edge Function) mock
// ---------------------------------------------------------------------------

function buildFunctionsMock(result: MockFnResult) {
  return {
    invoke: jest.fn().mockResolvedValue(result),
  };
}

// ---------------------------------------------------------------------------
// Root mock factory — the public API of this fixture.
// ---------------------------------------------------------------------------

export interface MockSupabaseOptions {
  /** Configures what `.from(...).select/insert/…` chains resolve to. */
  dbResult?: MockDbResult;
  /** Configures what `storage.from(...).createSignedUrl()` resolves to. */
  storageResult?: MockStorageResult;
  /** Configures what `functions.invoke()` resolves to. */
  fnResult?: MockFnResult;
  /** Configures what `auth.getUser()` resolves to. */
  authResult?: MockAuthResult;
}

export interface MockSupabase {
  /** The mock client — pass to `jest.mock('@/lib/supabase', ...)`. */
  client: {
    from: jest.Mock;
    storage: ReturnType<typeof buildStorageMock>;
    functions: ReturnType<typeof buildFunctionsMock>;
    auth: ReturnType<typeof buildAuthMock>;
  };
  /** Convenience: the last query chain returned by `.from()`. */
  lastChain: ReturnType<typeof buildQueryChain>;
}

/**
 * Creates a fresh, isolated Supabase mock for one test.
 *
 * Usage:
 * ```ts
 * jest.mock('@/lib/supabase');
 * import { supabase } from '@/lib/supabase';
 *
 * const mock = createMockSupabase({ dbResult: { data: [...], error: null } });
 * (supabase as unknown as typeof mock.client) = mock.client;
 * ```
 */
export function createMockSupabase(opts: MockSupabaseOptions = {}): MockSupabase {
  const dbResult: MockDbResult = opts.dbResult ?? { data: null, error: null };
  const storageResult: MockStorageResult = opts.storageResult ?? { data: null, error: null };
  const fnResult: MockFnResult = opts.fnResult ?? { data: null, error: null };
  const authResult: MockAuthResult = opts.authResult ?? {
    data: { user: { id: 'user-123' } },
    error: null,
  };

  const chain = buildQueryChain(dbResult);

  const client = {
    from: jest.fn().mockReturnValue(chain),
    storage: buildStorageMock(storageResult),
    functions: buildFunctionsMock(fnResult),
    auth: buildAuthMock(authResult),
  };

  return { client, lastChain: chain };
}

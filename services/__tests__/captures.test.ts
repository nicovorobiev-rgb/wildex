/**
 * services/__tests__/captures.test.ts
 *
 * Integration tests for services/captures.ts.
 * Framework: Jest 29 (spec/test-plan.md §1, §2.3).
 * Coverage target: ≥ 80% lines (spec/test-plan.md §5).
 *
 * Mock strategy:
 *   - `@/lib/supabase` is replaced with a jest auto-mock; each test
 *     injects a fresh createMockSupabase() instance via the supabase import
 *     so there is zero shared mutable state between tests.
 *   - The supabase module is mocked at the module boundary — the service
 *     code-under-test imports `supabase` and gets the mock transparently.
 *
 * Test IDs that align with spec/test-plan.md I-series:
 *   I3 — createCapture with no auth (edge function error surface)
 *   I7 — createCapture happy path persists a capture row
 *   I8 — createCapture ignores client-supplied stats (edge fn decides)
 */

import { createMockSupabase } from './__fixtures__/mock-supabase';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase before importing the module under test.
// jest.mock is hoisted, so the factory runs before any import.
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
    functions: { invoke: jest.fn() },
    auth: { getUser: jest.fn() },
  },
}));

// Import AFTER mock registration.
import { supabase } from '@/lib/supabase';
import {
  listCaptures,
  getCapture,
  createCapture,
  signCaptureImageUrl,
  type CreateCaptureInput,
  type Result,
} from '../captures';
import type { Capture } from '@/engine/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject a fresh mock into the imported supabase singleton. */
function injectMock(opts: Parameters<typeof createMockSupabase>[0] = {}) {
  const mock = createMockSupabase(opts);
  Object.assign(supabase as object, mock.client);
  return mock;
}

const SAMPLE_CAPTURE: Capture = {
  id: 'cap-001',
  user_id: 'user-123',
  taxon_id: 12345,
  common_name: 'Red Fox',
  scientific_name: 'Vulpes vulpes',
  score: 0.87,
  stats: {
    id: 'cap-001',
    hp: 80,
    attack: 30,
    defense: 20,
    speed: 35,
    special: 15,
    element: 'beast',
    rarity: 'uncommon',
  },
  xp: 0,
  age: 1,
  pending_points: 0,
  allocated: {},
  lat: 51.5,
  lng: -0.12,
  image_path: 'user-123/cap-001.jpg',
  created_at: '2026-01-01T00:00:00.000Z',
};

const SAMPLE_INPUT: CreateCaptureInput = {
  taxon_id: 12345,
  common_name: 'Red Fox',
  scientific_name: 'Vulpes vulpes',
  score: 0.87,
  image_storage_key: 'user-123/cap-001.jpg',
  lat: 51.5,
  lng: -0.12,
};

// ---------------------------------------------------------------------------
// listCaptures
// ---------------------------------------------------------------------------

describe('listCaptures', () => {
  it('happy path — returns ok:true with capture array', async () => {
    injectMock({ dbResult: { data: [SAMPLE_CAPTURE], error: null } });

    const result = await listCaptures();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('cap-001');
  });

  it('uses default limit of 50 and orders by created_at descending', async () => {
    const { lastChain } = injectMock({ dbResult: { data: [], error: null } });

    await listCaptures();

    expect(supabase.from).toHaveBeenCalledWith('captures');
    expect(lastChain.select).toHaveBeenCalled();
    expect(lastChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(lastChain.limit).toHaveBeenCalledWith(50);
  });

  it('passes custom limit option to the query', async () => {
    const { lastChain } = injectMock({ dbResult: { data: [], error: null } });

    await listCaptures({ limit: 10 });

    expect(lastChain.limit).toHaveBeenCalledWith(10);
  });

  it('applies cursor filter when cursor option is provided', async () => {
    const { lastChain } = injectMock({ dbResult: { data: [], error: null } });
    const cursor = '2026-01-01T00:00:00.000Z';

    await listCaptures({ cursor });

    expect(lastChain.lt).toHaveBeenCalledWith('created_at', cursor);
  });

  it('does NOT apply lt filter when cursor is omitted', async () => {
    const { lastChain } = injectMock({ dbResult: { data: [], error: null } });

    await listCaptures();

    expect(lastChain.lt).not.toHaveBeenCalled();
  });

  it('DB error — returns ok:false with prefixed error message', async () => {
    injectMock({ dbResult: { data: null, error: { message: 'connection refused' } } });

    const result = await listCaptures();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('listCaptures');
    expect(result.error.message).toContain('connection refused');
  });

  it('returns empty array when DB returns null data', async () => {
    injectMock({ dbResult: { data: null, error: null } });

    const result = await listCaptures();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual([]);
  });

  it('unexpected throw — returns ok:false without propagating', async () => {
    // Make the from() call throw synchronously.
    (supabase.from as jest.Mock).mockImplementation(() => {
      throw new Error('unexpected internal error');
    });

    const result = await listCaptures();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('listCaptures');
  });
});

// ---------------------------------------------------------------------------
// getCapture
// ---------------------------------------------------------------------------

describe('getCapture', () => {
  it('happy path — returns ok:true with the capture', async () => {
    injectMock({ dbResult: { data: SAMPLE_CAPTURE, error: null } });

    const result = await getCapture('cap-001');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toMatchObject({ id: 'cap-001' });
  });

  it('queries with the correct id via .eq()', async () => {
    const { lastChain } = injectMock({ dbResult: { data: SAMPLE_CAPTURE, error: null } });

    await getCapture('cap-001');

    expect(lastChain.eq).toHaveBeenCalledWith('id', 'cap-001');
    expect(lastChain.maybeSingle).toHaveBeenCalled();
  });

  it('returns ok:true with null when row is not found', async () => {
    injectMock({ dbResult: { data: null, error: null } });

    const result = await getCapture('nonexistent-id');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toBeNull();
  });

  it('DB error — returns ok:false with prefixed message', async () => {
    injectMock({ dbResult: { data: null, error: { message: 'row-level security violation' } } });

    const result = await getCapture('cap-001');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('getCapture');
    expect(result.error.message).toContain('row-level security violation');
  });

  it('unexpected throw — returns ok:false without propagating', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => {
      throw new Error('sudden crash');
    });

    const result = await getCapture('cap-001');

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCapture (I3, I7, I8)
// ---------------------------------------------------------------------------

describe('createCapture', () => {
  it('I7 — happy path — invokes edge function and returns ok:true with capture', async () => {
    injectMock({
      fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null },
    });

    const result = await createCapture(SAMPLE_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.id).toBe('cap-001');
  });

  it('invokes the create-capture edge function with correct function name', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    await createCapture(SAMPLE_INPUT);

    expect((supabase.functions.invoke as jest.Mock)).toHaveBeenCalledWith(
      'create-capture',
      expect.objectContaining({ body: expect.any(Object) }),
    );
  });

  it('sends storage_path from image_storage_key in the edge function body', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    await createCapture(SAMPLE_INPUT);

    const invokeArgs = (supabase.functions.invoke as jest.Mock).mock.calls[0];
    const body = invokeArgs[1].body;
    expect(body.storage_path).toBe('user-123/cap-001.jpg');
  });

  it('sends suggestion block with taxon fields in the edge function body', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    await createCapture(SAMPLE_INPUT);

    const body = (supabase.functions.invoke as jest.Mock).mock.calls[0][1].body;
    expect(body.suggestion).toMatchObject({
      taxonId: 12345,
      commonName: 'Red Fox',
      scientificName: 'Vulpes vulpes',
      score: 0.87,
    });
  });

  it('sends exif_datetime that is a valid ISO 8601 string', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    await createCapture(SAMPLE_INPUT);

    const body = (supabase.functions.invoke as jest.Mock).mock.calls[0][1].body;
    expect(() => new Date(body.exif_datetime)).not.toThrow();
    expect(new Date(body.exif_datetime).toISOString()).toBe(body.exif_datetime);
  });

  it('sends coords when lat/lng are provided', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    await createCapture(SAMPLE_INPUT); // has lat/lng

    const body = (supabase.functions.invoke as jest.Mock).mock.calls[0][1].body;
    expect(body.coords).toEqual({ lat: 51.5, lng: -0.12 });
  });

  it('sends null coords when lat/lng are omitted', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    const inputNoCoords: CreateCaptureInput = {
      ...SAMPLE_INPUT,
      lat: undefined,
      lng: undefined,
    };
    await createCapture(inputNoCoords);

    const body = (supabase.functions.invoke as jest.Mock).mock.calls[0][1].body;
    expect(body.coords).toBeNull();
  });

  it('I8 — does NOT send a stats field in the edge function body', async () => {
    injectMock({ fnResult: { data: { capture: SAMPLE_CAPTURE }, error: null } });

    await createCapture(SAMPLE_INPUT);

    const body = (supabase.functions.invoke as jest.Mock).mock.calls[0][1].body;
    // stats must be absent — the edge function is the authority on stats
    expect(body).not.toHaveProperty('stats');
  });

  it('I3 — edge function error — returns ok:false', async () => {
    injectMock({ fnResult: { data: null, error: { message: 'Unauthorized' } } });

    const result = await createCapture(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('createCapture');
    expect(result.error.message).toContain('Unauthorized');
  });

  it('edge function returns data without capture — returns ok:false', async () => {
    injectMock({ fnResult: { data: {}, error: null } });

    const result = await createCapture(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('no capture');
  });

  it('edge function returns null data — returns ok:false', async () => {
    injectMock({ fnResult: { data: null, error: null } });

    const result = await createCapture(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
  });

  it('unexpected throw — returns ok:false without propagating', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValueOnce(
      new Error('network failure'),
    );

    const result = await createCapture(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('createCapture');
  });
});

// ---------------------------------------------------------------------------
// signCaptureImageUrl
// ---------------------------------------------------------------------------

describe('signCaptureImageUrl', () => {
  it('happy path — returns ok:true with the signed URL string', async () => {
    injectMock({
      storageResult: {
        data: { signedUrl: 'https://example.com/signed?token=abc' },
        error: null,
      },
    });

    const result = await signCaptureImageUrl('user-123/cap-001.jpg');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toBe('https://example.com/signed?token=abc');
  });

  it('calls storage.from("captures").createSignedUrl with path and default TTL', async () => {
    const { client } = injectMock({
      storageResult: { data: { signedUrl: 'https://x.com/signed' }, error: null },
    });

    await signCaptureImageUrl('user-123/cap-001.jpg');

    expect(client.storage.from).toHaveBeenCalledWith('captures');
    expect(client.storage._bucket.createSignedUrl).toHaveBeenCalledWith(
      'user-123/cap-001.jpg',
      300, // default TTL
    );
  });

  it('forwards a custom expiresSec to createSignedUrl', async () => {
    const { client } = injectMock({
      storageResult: { data: { signedUrl: 'https://x.com/signed' }, error: null },
    });

    await signCaptureImageUrl('user-123/cap-001.jpg', 60);

    expect(client.storage._bucket.createSignedUrl).toHaveBeenCalledWith(
      'user-123/cap-001.jpg',
      60,
    );
  });

  it('storage error — returns ok:false with prefixed message', async () => {
    injectMock({
      storageResult: { data: null, error: { message: 'object not found' } },
    });

    const result = await signCaptureImageUrl('user-123/cap-001.jpg');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('signCaptureImageUrl');
    expect(result.error.message).toContain('object not found');
  });

  it('storage returns data without signedUrl — returns ok:false', async () => {
    injectMock({ storageResult: { data: { signedUrl: '' }, error: null } });

    const result = await signCaptureImageUrl('user-123/cap-001.jpg');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('no signed URL');
  });

  it('unexpected throw — returns ok:false without propagating', async () => {
    (supabase.storage.from as jest.Mock).mockImplementation(() => {
      throw new Error('storage crash');
    });

    const result = await signCaptureImageUrl('user-123/cap-001.jpg');

    expect(result.ok).toBe(false);
  });
});

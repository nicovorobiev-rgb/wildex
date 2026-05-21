/**
 * services/__tests__/battles.test.ts
 *
 * Integration tests for services/battles.ts.
 * Framework: Jest 29 (spec/test-plan.md §1, §2.3).
 * Coverage target: ≥ 80% lines (spec/test-plan.md §5).
 *
 * Test IDs that align with spec/test-plan.md I-series:
 *   I9  — non-addressed user cannot accept challenge
 *   I10 — acceptChallenge reads stats from DB (edge fn is authority)
 *   I11 — acceptChallenge returns existing result on 409 (idempotent)
 *
 * Note on Result shape:
 *   battles.ts uses { ok: true, value } / { ok: false, error } (Ok<T>/Err)
 *   which differs from captures.ts { ok: true, data } / { ok: false, error }.
 *   Tests assert the correct shape per the actual module exports.
 */

import { createMockSupabase } from './__fixtures__/mock-supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
    functions: { invoke: jest.fn() },
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from '@/lib/supabase';
import {
  sendChallenge,
  listChallenges,
  getChallenge,
  acceptChallenge,
  listBattles,
  getBattle,
  BattleServiceError,
  type Challenge,
  type Battle,
} from '../battles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function injectMock(opts: Parameters<typeof createMockSupabase>[0] = {}) {
  const mock = createMockSupabase(opts);
  Object.assign(supabase as object, mock.client);
  return mock;
}

const SAMPLE_CHALLENGE: Challenge = {
  id: 'ch-001',
  code: 'ABCD1234',
  challenger_id: 'user-aaa',
  challenger_capture: 'cap-aaa',
  challenger_stats: null,
  opponent_id: 'user-bbb',
  opponent_capture: 'cap-bbb',
  opponent_stats: null,
  seed: null,
  winner: null,
  created_at: '2026-01-01T00:00:00.000Z',
  resolved_at: null,
};

const SAMPLE_BATTLE: Battle = {
  id: 'battle-001',
  player_a: 'user-aaa',
  player_b: 'user-bbb',
  capture_a: 'cap-aaa',
  capture_b: 'cap-bbb',
  seed: 'cap-aaa:cap-bbb:1700000000000',
  winner: 'a',
  created_at: '2026-01-01T00:00:00.000Z',
};

const ACCEPT_CHALLENGE_RESPONSE = {
  winner: 'a' as const,
  seed: 'cap-aaa:cap-bbb:1700000000000',
  log: [{ turn: 1, attacker: 'a' as const, damage: 10, crit: false }],
  challenge_id: 'ch-001',
};

// ---------------------------------------------------------------------------
// sendChallenge
// ---------------------------------------------------------------------------

describe('sendChallenge', () => {
  it('happy path — returns ok:true with challenge_id', async () => {
    injectMock({ dbResult: { data: { id: 'ch-001' }, error: null } });

    const result = await sendChallenge({
      opponent_id: 'user-bbb',
      my_capture_id: 'cap-aaa',
      // opponent_capture_id removed — opponent picks at accept time (spec §2.9)
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.challenge_id).toBe('ch-001');
  });

  it('inserts into challenges table with correct fields', async () => {
    const { lastChain } = injectMock({ dbResult: { data: { id: 'ch-001' }, error: null } });

    await sendChallenge({
      opponent_id: 'user-bbb',
      my_capture_id: 'cap-aaa',
      // opponent_capture_id removed — opponent picks at accept time (spec §2.9)
    });

    expect(supabase.from).toHaveBeenCalledWith('challenges');
    expect(lastChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        challenger_capture: 'cap-aaa',
        opponent_id: 'user-bbb',
      }),
    );
    // opponent_capture and resolution fields must NOT be in the insert payload
    const insertArg = lastChain.insert.mock.calls[0][0];
    expect(insertArg).not.toHaveProperty('opponent_capture');
    expect(insertArg).not.toHaveProperty('winner');
    expect(insertArg).not.toHaveProperty('seed');
  });

  it('uses .select("id").single() to retrieve new row id', async () => {
    const { lastChain } = injectMock({ dbResult: { data: { id: 'ch-001' }, error: null } });

    await sendChallenge({
      opponent_id: 'user-bbb',
      my_capture_id: 'cap-aaa',
      // opponent_capture_id removed — opponent picks at accept time (spec §2.9)
    });

    expect(lastChain.select).toHaveBeenCalledWith('id');
    expect(lastChain.single).toHaveBeenCalled();
  });

  it('DB error — returns ok:false with BattleServiceError', async () => {
    injectMock({ dbResult: { data: null, error: { message: 'insert denied' } } });

    const result = await sendChallenge({
      opponent_id: 'user-bbb',
      my_capture_id: 'cap-aaa',
      // opponent_capture_id removed — opponent picks at accept time (spec §2.9)
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(BattleServiceError);
    expect(result.error.source).toBe('sendChallenge');
    expect(result.error.message).toContain('insert denied');
  });

  it('RLS violation — returns ok:false', async () => {
    injectMock({
      dbResult: { data: null, error: { message: 'new row violates row-level security policy' } },
    });

    const result = await sendChallenge({
      opponent_id: 'user-bbb',
      my_capture_id: 'cap-aaa',
      // opponent_capture_id removed — opponent picks at accept time (spec §2.9)
    });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listChallenges
// ---------------------------------------------------------------------------

describe('listChallenges', () => {
  it('happy path with filter=all — returns ok:true with challenge array', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [SAMPLE_CHALLENGE], error: null },
    });

    const result = await listChallenges('all');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('ch-001');
  });

  it('filter=outgoing — applies eq(challenger_id, userId)', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listChallenges('outgoing');

    expect(lastChain.eq).toHaveBeenCalledWith('challenger_id', 'user-aaa');
  });

  it('filter=incoming — applies eq(opponent_id, userId)', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listChallenges('incoming');

    expect(lastChain.eq).toHaveBeenCalledWith('opponent_id', 'user-aaa');
  });

  it('filter=all — does NOT apply an eq() filter (RLS handles scoping)', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listChallenges('all');

    expect(lastChain.eq).not.toHaveBeenCalled();
  });

  it('auth missing — returns ok:false with BattleServiceError', async () => {
    injectMock({
      authResult: { data: { user: null }, error: null },
    });

    const result = await listChallenges();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(BattleServiceError);
    expect(result.error.source).toBe('listChallenges');
    expect(result.error.message).toContain('not authenticated');
  });

  it('auth error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: null }, error: { message: 'session expired' } },
    });

    const result = await listChallenges();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('session expired');
  });

  it('DB error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: { message: 'DB timeout' } },
    });

    const result = await listChallenges();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('DB timeout');
  });

  it('returns empty array when DB returns null data', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: null },
    });

    const result = await listChallenges();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getChallenge
// ---------------------------------------------------------------------------

describe('getChallenge', () => {
  it('happy path — returns ok:true with the challenge', async () => {
    injectMock({ dbResult: { data: SAMPLE_CHALLENGE, error: null } });

    const result = await getChallenge('ch-001');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value?.id).toBe('ch-001');
  });

  it('queries with .eq("id", id).maybeSingle()', async () => {
    const { lastChain } = injectMock({ dbResult: { data: SAMPLE_CHALLENGE, error: null } });

    await getChallenge('ch-001');

    expect(supabase.from).toHaveBeenCalledWith('challenges');
    expect(lastChain.eq).toHaveBeenCalledWith('id', 'ch-001');
    expect(lastChain.maybeSingle).toHaveBeenCalled();
  });

  it('returns ok:true with null when challenge is not found', async () => {
    injectMock({ dbResult: { data: null, error: null } });

    const result = await getChallenge('nonexistent');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toBeNull();
  });

  it('DB error — returns ok:false with BattleServiceError', async () => {
    injectMock({ dbResult: { data: null, error: { message: 'permission denied' } } });

    const result = await getChallenge('ch-001');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(BattleServiceError);
  });
});

// ---------------------------------------------------------------------------
// acceptChallenge (I9, I10, I11)
// ---------------------------------------------------------------------------

describe('acceptChallenge', () => {
  // Helper: default input for acceptChallenge (opponent supplies their capture).
  const ACCEPT_INPUT = { challenge_id: 'ch-001', opponent_capture_id: 'cap-bbb' };

  it('I10 — happy path — invokes edge function and returns BattleResult', async () => {
    // First call (getChallenge via from()) resolves the challenge row.
    // Second call (functions.invoke) resolves the accept-challenge edge fn.
    const mock = createMockSupabase({
      dbResult: { data: SAMPLE_CHALLENGE, error: null },
      fnResult: { data: ACCEPT_CHALLENGE_RESPONSE, error: null },
    });
    Object.assign(supabase as object, mock.client);

    const result = await acceptChallenge(ACCEPT_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.winner).toBe('a');
    expect(result.value.log).toHaveLength(1);
  });

  it('I10 — invokes accept-challenge edge fn with code from DB row and caller-supplied opponent_capture_id', async () => {
    const mock = createMockSupabase({
      dbResult: { data: SAMPLE_CHALLENGE, error: null },
      fnResult: { data: ACCEPT_CHALLENGE_RESPONSE, error: null },
    });
    Object.assign(supabase as object, mock.client);

    await acceptChallenge(ACCEPT_INPUT);

    expect(mock.client.functions.invoke).toHaveBeenCalledWith(
      'accept-challenge',
      {
        body: {
          code: 'ABCD1234',       // resolved from DB row — not client-supplied
          opponent_capture_id: 'cap-bbb', // passed directly by the caller (spec §4.6)
        },
      },
    );
  });

  it('challenge not found — returns ok:false', async () => {
    const mock = createMockSupabase({
      dbResult: { data: null, error: null }, // maybeSingle returns null
      fnResult: { data: null, error: null },
    });
    Object.assign(supabase as object, mock.client);

    const result = await acceptChallenge({ challenge_id: 'missing-id', opponent_capture_id: 'cap-bbb' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('not found');
  });

  it('I9 — edge function returns 403 error — returns ok:false', async () => {
    const mock = createMockSupabase({
      dbResult: { data: SAMPLE_CHALLENGE, error: null },
      fnResult: { data: null, error: { message: 'Forbidden: not the addressed opponent' } },
    });
    Object.assign(supabase as object, mock.client);

    const result = await acceptChallenge(ACCEPT_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('Forbidden');
  });

  it('I11 — edge function returns 409 error (idempotent) — returns ok:false', async () => {
    const mock = createMockSupabase({
      dbResult: { data: SAMPLE_CHALLENGE, error: null },
      fnResult: { data: null, error: { message: 'Conflict: challenge already resolved' } },
    });
    Object.assign(supabase as object, mock.client);

    const result = await acceptChallenge(ACCEPT_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('Conflict');
  });

  it('edge function returns no data — returns ok:false', async () => {
    const mock = createMockSupabase({
      dbResult: { data: SAMPLE_CHALLENGE, error: null },
      fnResult: { data: null, error: null },
    });
    Object.assign(supabase as object, mock.client);

    const result = await acceptChallenge(ACCEPT_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('no data');
  });

  it('getChallenge DB error propagates as ok:false', async () => {
    const mock = createMockSupabase({
      dbResult: { data: null, error: { message: 'DB error on lookup' } },
      fnResult: { data: null, error: null },
    });
    Object.assign(supabase as object, mock.client);

    const result = await acceptChallenge(ACCEPT_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('DB error on lookup');
  });
});

// ---------------------------------------------------------------------------
// listBattles
// ---------------------------------------------------------------------------

describe('listBattles', () => {
  it('happy path — returns ok:true with battle array', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [SAMPLE_BATTLE], error: null },
    });

    const result = await listBattles();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('battle-001');
  });

  it('uses .or() filter with both player columns', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listBattles();

    expect(lastChain.or).toHaveBeenCalledWith(
      'player_a.eq.user-aaa,player_b.eq.user-aaa',
    );
  });

  it('forwards the limit argument', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listBattles(20);

    expect(lastChain.limit).toHaveBeenCalledWith(20);
  });

  it('auth missing — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: null }, error: null },
    });

    const result = await listBattles();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(BattleServiceError);
    expect(result.error.source).toBe('listBattles');
  });

  it('DB error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: { message: 'query timed out' } },
    });

    const result = await listBattles();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('query timed out');
  });

  it('returns empty array when DB returns null', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: null },
    });

    const result = await listBattles();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBattle
// ---------------------------------------------------------------------------

describe('getBattle', () => {
  it('happy path — returns ok:true with the battle', async () => {
    injectMock({ dbResult: { data: SAMPLE_BATTLE, error: null } });

    const result = await getBattle('battle-001');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value?.id).toBe('battle-001');
  });

  it('queries battles table with eq("id", id) and maybeSingle()', async () => {
    const { lastChain } = injectMock({ dbResult: { data: SAMPLE_BATTLE, error: null } });

    await getBattle('battle-001');

    expect(supabase.from).toHaveBeenCalledWith('battles');
    expect(lastChain.eq).toHaveBeenCalledWith('id', 'battle-001');
    expect(lastChain.maybeSingle).toHaveBeenCalled();
  });

  it('returns ok:true with null when battle is not found', async () => {
    injectMock({ dbResult: { data: null, error: null } });

    const result = await getBattle('nonexistent');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toBeNull();
  });

  it('DB error — returns ok:false', async () => {
    injectMock({ dbResult: { data: null, error: { message: 'permission denied' } } });

    const result = await getBattle('battle-001');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(BattleServiceError);
  });
});

// ---------------------------------------------------------------------------
// BattleServiceError
// ---------------------------------------------------------------------------

describe('BattleServiceError', () => {
  it('has name BattleServiceError', () => {
    const e = new BattleServiceError('myFn', new Error('root cause'));
    expect(e.name).toBe('BattleServiceError');
  });

  it('includes source in the message', () => {
    const e = new BattleServiceError('myFn', new Error('root cause'));
    expect(e.message).toContain('myFn');
    expect(e.message).toContain('root cause');
  });

  it('handles non-Error cause (string)', () => {
    const e = new BattleServiceError('myFn', 'string error');
    expect(e.message).toContain('string error');
  });
});

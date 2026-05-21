/**
 * services/__tests__/friends.test.ts
 *
 * Integration tests for services/friends.ts.
 * Framework: Jest 29 (spec/test-plan.md §1, §2.3).
 * Coverage target: ≥ 80% lines (spec/test-plan.md §5).
 *
 * Test IDs that align with spec/test-plan.md I-series:
 *   I15 — friend codes round-trip: add → list shows both sides
 *
 * Note on Result shape:
 *   friends.ts uses { ok: true, data } / { ok: false, error } (Ok<T>/Err).
 *   BattleServiceError is FriendsServiceError here.
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
  listFriends,
  listPendingRequests,
  addFriend,
  acceptFriendRequest,
  removeFriend,
  getMyFriendCode,
  FriendsServiceError,
  type Friend,
  type FriendRequest,
} from '../friends';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function injectMock(opts: Parameters<typeof createMockSupabase>[0] = {}) {
  const mock = createMockSupabase(opts);
  Object.assign(supabase as object, mock.client);
  return mock;
}

// Mirrors FriendshipWithProfile internal structure
const SAMPLE_FRIENDSHIP_ROW = {
  user_id: 'user-aaa',
  friend_id: 'user-bbb',
  status: 'accepted',
  created_at: '2026-01-01T00:00:00.000Z',
  accepted_at: '2026-01-02T00:00:00.000Z',
  profiles: {
    user_id: 'user-bbb',
    display_name: 'Bob',
    friend_code: 'BBBB-1234',
  },
};

const SAMPLE_PENDING_ROW = {
  user_id: 'user-ccc',
  friend_id: 'user-aaa',
  status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  accepted_at: null,
  profiles: {
    user_id: 'user-ccc',
    display_name: 'Charlie',
    friend_code: 'CCCC-5678',
  },
};

// ---------------------------------------------------------------------------
// listFriends
// ---------------------------------------------------------------------------

describe('listFriends', () => {
  it('happy path — returns ok:true with Friend array', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [SAMPLE_FRIENDSHIP_ROW], error: null },
    });

    const result = await listFriends();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].user_id).toBe('user-bbb');
    expect(result.data[0].display_name).toBe('Bob');
    expect(result.data[0].friend_code).toBe('BBBB-1234');
    expect(result.data[0].accepted_at).toBe('2026-01-02T00:00:00.000Z');
  });

  it('queries friendships table with eq(user_id) and eq(status, accepted)', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listFriends();

    expect(supabase.from).toHaveBeenCalledWith('friendships');
    expect(lastChain.eq).toHaveBeenCalledWith('user_id', 'user-aaa');
    expect(lastChain.eq).toHaveBeenCalledWith('status', 'accepted');
  });

  it('includes profile join in the select call', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listFriends();

    expect(lastChain.select).toHaveBeenCalledWith(
      expect.stringContaining('profiles!friendships_friend_id_fkey'),
    );
  });

  it('returns empty array when DB returns null', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: null },
    });

    const result = await listFriends();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual([]);
  });

  it('auth missing — returns ok:false with FriendsServiceError', async () => {
    injectMock({
      authResult: { data: { user: null }, error: null },
    });

    const result = await listFriends();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(FriendsServiceError);
    expect(result.error.source).toBe('listFriends');
  });

  it('DB error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: { message: 'RLS denied' } },
    });

    const result = await listFriends();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('RLS denied');
  });
});

// ---------------------------------------------------------------------------
// listPendingRequests
// ---------------------------------------------------------------------------

describe('listPendingRequests', () => {
  it('direction=incoming — returns ok:true with FriendRequest array', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [SAMPLE_PENDING_ROW], error: null },
    });

    const result = await listPendingRequests('incoming');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].requester_id).toBe('user-ccc');
    expect(result.data[0].requester_display_name).toBe('Charlie');
    expect(result.data[0].target_id).toBe('user-aaa');
  });

  it('direction=incoming — filters by friend_id = userId', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listPendingRequests('incoming');

    expect(lastChain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(lastChain.eq).toHaveBeenCalledWith('friend_id', 'user-aaa');
  });

  it('direction=outgoing — filters by user_id = userId', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listPendingRequests('outgoing');

    expect(lastChain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(lastChain.eq).toHaveBeenCalledWith('user_id', 'user-aaa');
  });

  it('direction=incoming uses user_id FK hint for profile join', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listPendingRequests('incoming');

    expect(lastChain.select).toHaveBeenCalledWith(
      expect.stringContaining('profiles!friendships_user_id_fkey'),
    );
  });

  it('direction=outgoing uses friend_id FK hint for profile join', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [], error: null },
    });

    await listPendingRequests('outgoing');

    expect(lastChain.select).toHaveBeenCalledWith(
      expect.stringContaining('profiles!friendships_friend_id_fkey'),
    );
  });

  it('direction=outgoing — requester_display_name is null (not in edge fn response)', async () => {
    const outgoingRow = {
      ...SAMPLE_PENDING_ROW,
      user_id: 'user-aaa',
      friend_id: 'user-bbb',
    };
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: [outgoingRow], error: null },
    });

    const result = await listPendingRequests('outgoing');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data[0].requester_display_name).toBeNull();
  });

  it('auth missing — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: null }, error: null },
    });

    const result = await listPendingRequests('incoming');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(FriendsServiceError);
    expect(result.error.source).toBe('listPendingRequests');
  });

  it('DB error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: { message: 'bad query' } },
    });

    const result = await listPendingRequests('incoming');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('bad query');
  });
});

// ---------------------------------------------------------------------------
// addFriend (I15)
// ---------------------------------------------------------------------------

describe('addFriend', () => {
  it('I15 — happy path — invokes add-friend edge fn and returns pending/accepted', async () => {
    injectMock({
      fnResult: {
        data: {
          friendship: {
            user_id: 'user-aaa',
            friend_id: 'user-bbb',
            status: 'pending',
            created_at: '2026-01-01T00:00:00.000Z',
            accepted_at: null,
          },
        },
        error: null,
      },
    });

    const result = await addFriend('BBBB-1234');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.status).toBe('pending');
    expect(result.data.friend.user_id).toBe('user-bbb');
    expect(result.data.friend.friend_code).toBe('BBBB-1234');
  });

  it('invokes add-friend edge function with the friend_code in the body', async () => {
    injectMock({
      fnResult: {
        data: {
          friendship: {
            user_id: 'user-aaa',
            friend_id: 'user-bbb',
            status: 'accepted',
            created_at: '2026-01-01T00:00:00.000Z',
            accepted_at: '2026-01-01T00:00:01.000Z',
          },
        },
        error: null,
      },
    });

    await addFriend('BBBB-1234');

    expect((supabase.functions.invoke as jest.Mock)).toHaveBeenCalledWith(
      'add-friend',
      { body: { friend_code: 'BBBB-1234' } },
    );
  });

  it('accepted status — friend.accepted_at is populated', async () => {
    injectMock({
      fnResult: {
        data: {
          friendship: {
            user_id: 'user-aaa',
            friend_id: 'user-bbb',
            status: 'accepted',
            created_at: '2026-01-01T00:00:00.000Z',
            accepted_at: '2026-01-01T00:01:00.000Z',
          },
        },
        error: null,
      },
    });

    const result = await addFriend('BBBB-1234');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.status).toBe('accepted');
    expect(result.data.friend.accepted_at).toBe('2026-01-01T00:01:00.000Z');
  });

  it('edge function error — returns ok:false', async () => {
    injectMock({
      fnResult: { data: null, error: { message: 'friend code not found' } },
    });

    const result = await addFriend('XXXX-9999');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(FriendsServiceError);
    expect(result.error.message).toContain('friend code not found');
  });

  it('edge function returns data without friendship — returns ok:false', async () => {
    injectMock({ fnResult: { data: {}, error: null } });

    const result = await addFriend('BBBB-1234');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('unexpected response');
  });

  it('edge function returns null data — returns ok:false', async () => {
    injectMock({ fnResult: { data: null, error: null } });

    const result = await addFriend('BBBB-1234');

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// acceptFriendRequest
// ---------------------------------------------------------------------------

describe('acceptFriendRequest', () => {
  it('happy path — invokes accept-friend edge fn and returns Friend', async () => {
    injectMock({
      fnResult: {
        data: {
          friendship: {
            user_id: 'user-ccc',
            friend_id: 'user-aaa',
            status: 'accepted',
            accepted_at: '2026-01-02T00:00:00.000Z',
          },
        },
        error: null,
      },
    });

    const result = await acceptFriendRequest('user-ccc');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.friend.user_id).toBe('user-ccc');
    expect(result.data.friend.accepted_at).toBe('2026-01-02T00:00:00.000Z');
  });

  it('invokes accept-friend with requester_id in the body', async () => {
    injectMock({
      fnResult: {
        data: {
          friendship: {
            user_id: 'user-ccc',
            friend_id: 'user-aaa',
            status: 'accepted',
            accepted_at: '2026-01-02T00:00:00.000Z',
          },
        },
        error: null,
      },
    });

    await acceptFriendRequest('user-ccc');

    expect((supabase.functions.invoke as jest.Mock)).toHaveBeenCalledWith(
      'accept-friend',
      { body: { requester_id: 'user-ccc' } },
    );
  });

  it('friend.display_name and friend_code are empty/null (require listFriends refresh)', async () => {
    injectMock({
      fnResult: {
        data: {
          friendship: {
            user_id: 'user-ccc',
            friend_id: 'user-aaa',
            status: 'accepted',
            accepted_at: '2026-01-02T00:00:00.000Z',
          },
        },
        error: null,
      },
    });

    const result = await acceptFriendRequest('user-ccc');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // display_name and friend_code require a follow-up listFriends call
    expect(result.data.friend.display_name).toBeNull();
    expect(result.data.friend.friend_code).toBe('');
  });

  it('edge function error — returns ok:false', async () => {
    injectMock({
      fnResult: { data: null, error: { message: 'request not found' } },
    });

    const result = await acceptFriendRequest('user-ccc');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(FriendsServiceError);
    expect(result.error.message).toContain('request not found');
  });

  it('edge function returns no friendship — returns ok:false', async () => {
    injectMock({ fnResult: { data: {}, error: null } });

    const result = await acceptFriendRequest('user-ccc');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('unexpected response');
  });
});

// ---------------------------------------------------------------------------
// removeFriend
// ---------------------------------------------------------------------------

describe('removeFriend', () => {
  it('happy path — returns ok:true with void data', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: null },
    });

    const result = await removeFriend('user-bbb');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toBeUndefined();
  });

  it('calls from("friendships").delete().eq(user_id, me).eq(friend_id, them)', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: null },
    });

    await removeFriend('user-bbb');

    expect(supabase.from).toHaveBeenCalledWith('friendships');
    expect(lastChain.delete).toHaveBeenCalled();
    expect(lastChain.eq).toHaveBeenCalledWith('user_id', 'user-aaa');
    expect(lastChain.eq).toHaveBeenCalledWith('friend_id', 'user-bbb');
  });

  it('auth missing — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: null }, error: null },
    });

    const result = await removeFriend('user-bbb');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(FriendsServiceError);
    expect(result.error.source).toBe('removeFriend');
  });

  it('primary delete DB error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: { message: 'delete violates FK constraint' } },
    });

    const result = await removeFriend('user-bbb');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('delete violates FK constraint');
  });

  it('secondary (reverse) delete error is silently swallowed — result is ok:true', async () => {
    // The primary delete succeeds; the reverse row delete may fail under strict RLS.
    // services/friends.ts documents this limitation and swallows the second error.
    //
    // To simulate: first call to from() returns a chain that resolves to success,
    // second call to from() returns a chain that resolves to error.
    const successChain = createMockSupabase({
      dbResult: { data: null, error: null },
    });
    const errorChain = createMockSupabase({
      dbResult: { data: null, error: { message: 'second delete denied' } },
    });

    let callCount = 0;
    (supabase.from as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return successChain.lastChain;
      return errorChain.lastChain;
    });
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user-aaa' } },
      error: null,
    });

    const result = await removeFriend('user-bbb');

    // The service explicitly ignores the reverse-delete error
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMyFriendCode
// ---------------------------------------------------------------------------

describe('getMyFriendCode', () => {
  it('happy path — returns ok:true with the friend code string', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: { friend_code: 'AAAA-0001' }, error: null },
    });

    const result = await getMyFriendCode();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toBe('AAAA-0001');
  });

  it('queries profiles table with eq("user_id", userId) and single()', async () => {
    const { lastChain } = injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: { friend_code: 'AAAA-0001' }, error: null },
    });

    await getMyFriendCode();

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(lastChain.select).toHaveBeenCalledWith('friend_code');
    expect(lastChain.eq).toHaveBeenCalledWith('user_id', 'user-aaa');
    expect(lastChain.single).toHaveBeenCalled();
  });

  it('auth missing — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: null }, error: null },
    });

    const result = await getMyFriendCode();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(FriendsServiceError);
    expect(result.error.source).toBe('getMyFriendCode');
  });

  it('DB error — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: null, error: { message: 'no rows returned' } },
    });

    const result = await getMyFriendCode();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('no rows returned');
  });

  it('profile exists but friend_code is missing/falsy — returns ok:false', async () => {
    injectMock({
      authResult: { data: { user: { id: 'user-aaa' } }, error: null },
      dbResult: { data: { friend_code: '' }, error: null },
    });

    const result = await getMyFriendCode();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.message).toContain('friend_code');
  });
});

// ---------------------------------------------------------------------------
// FriendsServiceError
// ---------------------------------------------------------------------------

describe('FriendsServiceError', () => {
  it('has name FriendsServiceError', () => {
    const e = new FriendsServiceError('myFn', new Error('root cause'));
    expect(e.name).toBe('FriendsServiceError');
  });

  it('message includes source prefix and cause', () => {
    const e = new FriendsServiceError('listFriends', new Error('db down'));
    expect(e.message).toContain('listFriends');
    expect(e.message).toContain('db down');
  });

  it('handles non-Error string cause', () => {
    const e = new FriendsServiceError('addFriend', 'code not found');
    expect(e.message).toContain('code not found');
  });

  it('source property is accessible', () => {
    const e = new FriendsServiceError('removeFriend', 'oops');
    expect(e.source).toBe('removeFriend');
  });
});

// services/friends.ts — Wildex v0.2 friends service layer.
//
// Spec refs:
//   spec/data-model.md §2.1 (profiles), §2.5 (friendships), §3.4 (add-friend), §3.5 (accept-friend)
//   spec/architecture.md §2 (services/ module boundaries)
//
// Allowed imports: @/engine/types, @/lib/supabase
// No React. No hooks. All errors via Result union.

import type { Friend, FriendRequest } from '@/engine/types';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Result union — error handling contract for all public functions.
// ---------------------------------------------------------------------------

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: FriendsServiceError };
export type Result<T> = Ok<T> | Err;

export class FriendsServiceError extends Error {
  constructor(
    public readonly source: string,
    public readonly cause: unknown,
  ) {
    const msg =
      cause instanceof Error ? cause.message : String(cause);
    super(`FriendsService.${source}: ${msg}`);
    this.name = 'FriendsServiceError';
  }
}

function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

function err(source: string, cause: unknown): Err {
  return { ok: false, error: new FriendsServiceError(source, cause) };
}

// ---------------------------------------------------------------------------
// Friend and FriendRequest are now canonical in engine/types.ts.
// Re-exported here so any callers importing from 'services/friends' continue
// to resolve without changing their import paths.
// ---------------------------------------------------------------------------
export type { Friend, FriendRequest } from '@/engine/types';

// ---------------------------------------------------------------------------
// Raw DB row types (private — never leak outside this file).
// ---------------------------------------------------------------------------

type FriendshipRow = {
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  accepted_at: string | null;
};

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  friend_code: string;
};

type FriendshipWithProfile = FriendshipRow & {
  profiles: ProfileRow;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function buildFriend(friendUserId: string, profile: ProfileRow, acceptedAt: string | null): Friend {
  return {
    user_id: friendUserId,
    display_name: profile.display_name,
    friend_code: profile.friend_code,
    accepted_at: acceptedAt,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all accepted friendships for the current user, joined with the
 * friend's profile for display_name and friend_code.
 *
 * The friendships table stores two rows per accepted pair (symmetric). We
 * select rows where user_id = me (the "outbound" canonical side after accept),
 * then resolve the friend's profile from the friend_id column.
 */
export async function listFriends(): Promise<Result<Friend[]>> {
  const userId = await getCurrentUserId();
  if (!userId) return err('listFriends', 'no authenticated user');

  const { data, error } = await supabase
    .from('friendships')
    .select('user_id, friend_id, status, created_at, accepted_at, profiles!friendships_friend_id_fkey(user_id, display_name, friend_code)')
    .eq('user_id', userId)
    .eq('status', 'accepted');

  if (error) return err('listFriends', error);

  const friends: Friend[] = ((data ?? []) as unknown as FriendshipWithProfile[]).map((row) =>
    buildFriend(row.friend_id, row.profiles, row.accepted_at),
  );

  return ok(friends);
}

/**
 * Returns pending friendship rows the current user is involved in.
 *
 * direction='incoming': rows where friend_id = me (someone sent me a request).
 * direction='outgoing': rows where user_id = me (I sent a request).
 */
export async function listPendingRequests(
  direction: 'incoming' | 'outgoing',
): Promise<Result<FriendRequest[]>> {
  const userId = await getCurrentUserId();
  if (!userId) return err('listPendingRequests', 'no authenticated user');

  const isIncoming = direction === 'incoming';

  // For incoming: match on friend_id = me; join requester profile via user_id FK.
  // For outgoing: match on user_id = me; join target profile via friend_id FK.
  const fkHint = isIncoming
    ? 'profiles!friendships_user_id_fkey(user_id, display_name, friend_code)'
    : 'profiles!friendships_friend_id_fkey(user_id, display_name, friend_code)';

  const query = supabase
    .from('friendships')
    .select(`user_id, friend_id, status, created_at, accepted_at, ${fkHint}`)
    .eq('status', 'pending');

  const { data, error } = await (isIncoming
    ? query.eq('friend_id', userId)
    : query.eq('user_id', userId));

  if (error) return err('listPendingRequests', error);

  const rows = (data ?? []) as unknown as FriendshipWithProfile[];

  const requests: FriendRequest[] = rows.map((row) => ({
    requester_id: row.user_id,
    requester_display_name: isIncoming ? row.profiles.display_name : null,
    requester_friend_code: isIncoming ? row.profiles.friend_code : '',
    target_id: row.friend_id,
    created_at: row.created_at,
  }));

  return ok(requests);
}

/**
 * Sends a friend request via the add-friend Edge Function.
 * The Edge Function resolves friend_code → uuid (service-role-only lookup),
 * inserts a pending row, and auto-accepts if the reverse-direction row exists.
 *
 * Returns the resulting status and a Friend object (populated once the Edge
 * Function response provides enough to build one; display_name may be null
 * until the friend accepts and their profile is fetched separately).
 */
export async function addFriend(
  friend_code: string,
): Promise<Result<{ status: 'pending' | 'accepted'; friend: Friend }>> {
  const { data, error } = await supabase.functions.invoke<{
    friendship: {
      user_id: string;
      friend_id: string;
      status: 'pending' | 'accepted';
      created_at: string;
      accepted_at?: string | null;
    };
  }>('add-friend', { body: { friend_code } });

  if (error) return err('addFriend', error);
  if (!data?.friendship) return err('addFriend', 'unexpected response from add-friend');

  const f = data.friendship;
  const friend: Friend = {
    user_id: f.friend_id,
    display_name: null,   // Edge Fn does not return profile — caller fetches via listFriends
    friend_code,          // we know the code; display_name requires a follow-up query
    accepted_at: f.accepted_at ?? null,
  };

  return ok({ status: f.status, friend });
}

/**
 * Accepts an incoming pending friend request via the accept-friend Edge Function.
 * The Edge Function updates the pending row to accepted and inserts the reverse row
 * atomically under service role.
 */
export async function acceptFriendRequest(
  requester_id: string,
): Promise<Result<{ friend: Friend }>> {
  const { data, error } = await supabase.functions.invoke<{
    friendship: {
      user_id: string;
      friend_id: string;
      status: 'accepted';
      accepted_at: string;
    };
  }>('accept-friend', { body: { requester_id } });

  if (error) return err('acceptFriendRequest', error);
  if (!data?.friendship) return err('acceptFriendRequest', 'unexpected response from accept-friend');

  const f = data.friendship;
  const friend: Friend = {
    user_id: f.user_id,   // the requester who sent the original pending row
    display_name: null,   // not in Edge Fn response; caller uses listFriends for display
    friend_code: '',      // same — requires a listFriends refresh to populate
    accepted_at: f.accepted_at,
  };

  return ok({ friend });
}

/**
 * Removes a friend by deleting the current user's side of the friendship.
 *
 * Per spec/data-model.md §2.5 RLS: `friendships delete own` policy allows
 * DELETE where auth.uid() = user_id. The accept-friend Edge Function stores
 * both directions; RLS only allows a user to delete the rows they own
 * (user_id = me). We delete both directions sequentially — the second delete
 * targets the row where we are friend_id (stored as user_id = them, friend_id = me).
 *
 * Note: per the RLS policy, the client can only delete rows where user_id = auth.uid().
 * Both symmetric rows are accessible: (me→them) directly, and (them→me) where
 * me = friend_id. However, the RLS policy for DELETE only permits `user_id = me`,
 * so we can only delete our side. The second row (their side) requires service-role
 * cleanup — which spec §2.5 assigns to the Edge Fn. Since no unfriend Edge Fn
 * exists in v0.2, we delete only our side here and document the limitation.
 */
export async function removeFriend(friend_user_id: string): Promise<Result<void>> {
  const userId = await getCurrentUserId();
  if (!userId) return err('removeFriend', 'no authenticated user');

  // Delete the row the current user owns (user_id = me, friend_id = them).
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('user_id', userId)
    .eq('friend_id', friend_user_id);

  if (error) return err('removeFriend', error);

  // Attempt to delete the reverse row if RLS permits (it won't on strict policies,
  // but we try so a future policy change or service-role upgrade gains this for free).
  await supabase
    .from('friendships')
    .delete()
    .eq('user_id', friend_user_id)
    .eq('friend_id', userId);
  // Silently ignore errors on the reverse delete — the caller's side is gone.

  return ok(undefined);
}

/**
 * Returns the current user's own friend_code from their profiles row.
 * The profiles SELECT policy only permits reading own row (auth.uid() = user_id).
 */
export async function getMyFriendCode(): Promise<Result<string>> {
  const userId = await getCurrentUserId();
  if (!userId) return err('getMyFriendCode', 'no authenticated user');

  const { data, error } = await supabase
    .from('profiles')
    .select('friend_code')
    .eq('user_id', userId)
    .single();

  if (error) return err('getMyFriendCode', error);
  if (!data?.friend_code) return err('getMyFriendCode', 'profile missing friend_code');

  return ok(data.friend_code as string);
}

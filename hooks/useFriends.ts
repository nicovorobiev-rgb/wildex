// hooks/useFriends.ts — Wildex v0.2 friends data hooks.
//
// Spec refs:
//   spec/architecture.md §5 (React Query for server state)
//   spec/architecture.md §2 (hooks/ module boundaries)
//
// Dependency contract (architecture.md §9):
//   hooks/ may import from: services/, engine/, lib/capabilities.ts
//   hooks/ must NOT import from: app/, components/, lib/supabase.ts directly
//
// React Query v5 API. Install: npm install @tanstack/react-query@^5

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  listFriends,
  listPendingRequests,
  addFriend,
  acceptFriendRequest,
  removeFriend,
  getMyFriendCode,
  type Friend,
  type FriendRequest,
  type FriendsServiceError,
} from '@/services/friends';
import { useAuth } from '@/lib/AuthContext';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

const friendsKeys = {
  /** Root key — invalidating this invalidates all friends-related queries. */
  all: ['friends'] as const,
  /** Accepted friends list for the current user. */
  list: (userId: string) => ['friends', userId] as const,
  /** Pending requests, split by direction. */
  pending: (userId: string, direction: 'incoming' | 'outgoing') =>
    ['friends', 'pending', userId, direction] as const,
  /** Current user's own friend code. */
  myCode: (userId: string) => ['my-friend-code', userId] as const,
};

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * Returns all accepted friends for the current user.
 * Disabled when no authenticated user is present.
 */
export function useFriends(): UseQueryResult<Friend[], FriendsServiceError> {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: friendsKeys.list(userId ?? ''),
    queryFn: async () => {
      const result = await listFriends();
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: userId !== null,
  });
}

/**
 * Returns pending friend requests in the given direction:
 *   'incoming' — requests sent TO the current user.
 *   'outgoing' — requests sent BY the current user.
 *
 * Disabled when no authenticated user is present.
 */
export function usePendingRequests(
  direction: 'incoming' | 'outgoing',
): UseQueryResult<FriendRequest[], FriendsServiceError> {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: friendsKeys.pending(userId ?? '', direction),
    queryFn: async () => {
      const result = await listPendingRequests(direction);
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: userId !== null,
  });
}

/**
 * Returns the current user's own friend_code.
 * Long staleTime: the friend code is assigned once and never changes in v0.2.
 * Disabled when no authenticated user is present.
 */
export function useMyFriendCode(): UseQueryResult<string, FriendsServiceError> {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: friendsKeys.myCode(userId ?? ''),
    queryFn: async () => {
      const result = await getMyFriendCode();
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: userId !== null,
    // Friend codes never change after profile creation — treat as effectively static.
    staleTime: 24 * 60 * 60 * 1_000, // 24 hours
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

type AddFriendResult = { status: 'pending' | 'accepted'; friend: Friend };

/**
 * Sends a friend request using the target's friend_code.
 * Invalidates all ['friends'] queries on success so lists refresh.
 */
export function useAddFriend(): UseMutationResult<
  AddFriendResult,
  FriendsServiceError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friend_code: string) => {
      const result = await addFriend(friend_code);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendsKeys.all });
    },
  });
}

/**
 * Accepts an incoming pending friend request identified by the requester's user id.
 * Invalidates all ['friends'] queries on success.
 */
export function useAcceptFriendRequest(): UseMutationResult<
  { friend: Friend },
  FriendsServiceError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requester_id: string) => {
      const result = await acceptFriendRequest(requester_id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendsKeys.all });
    },
  });
}

/**
 * Removes a friend by their user id.
 * Invalidates all ['friends'] queries on success.
 */
export function useRemoveFriend(): UseMutationResult<
  void,
  FriendsServiceError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friend_user_id: string) => {
      const result = await removeFriend(friend_user_id);
      if (!result.ok) throw result.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendsKeys.all });
    },
  });
}

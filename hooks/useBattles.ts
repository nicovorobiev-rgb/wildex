/**
 * hooks/useBattles.ts — React Query hooks for battles and challenges.
 *
 * Wraps services/battles.ts. All hooks unwrap Result<T> from the service layer
 * and throw on Err so React Query surfaces errors via the standard `error` field.
 *
 * Allowed imports: @tanstack/react-query, @/services/battles, @/engine/types,
 *                  @/lib/AuthContext
 * No JSX. No direct Supabase imports (spec/architecture.md §9).
 *
 * // TODO(R6): npm install @tanstack/react-query@^5
 *
 * Spec refs:
 *   spec/architecture.md §5 (State management — React Query + AuthContext)
 *   spec/architecture.md §9 (Dependency direction rules)
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import {
  listChallenges,
  getChallenge,
  sendChallenge,
  acceptChallenge,
  listBattles,
  getBattle,
  type Challenge,
  type Battle,
  type SendChallengeInput,
  type AcceptChallengeInput,
  BattleServiceError,
} from '@/services/battles';
import { getCapture } from '@/services/captures';
import { simulateBattle, type BattleOutcome } from '@/engine/battle';
import type { BattleResult, Capture } from '@/engine/types';
import { useAuth } from '@/lib/AuthContext';

// ---------------------------------------------------------------------------
// Internal helper: unwrap Result<T>, throw BattleServiceError on Err.
// Keeps individual query/mutation fns under 20 lines (spec constraint).
// ---------------------------------------------------------------------------

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: BattleServiceError }): T {
  if (!result.ok) throw result.error;
  return result.value;
}

// ---------------------------------------------------------------------------
// useChallenges
//
// Fetches the challenge list for the current user, optionally filtered by
// direction. Query is disabled when there is no authenticated user.
//
// Key: ['challenges', userId, filter]
// ---------------------------------------------------------------------------

export function useChallenges(
  filter: 'incoming' | 'outgoing' | 'all' = 'all',
): UseQueryResult<Challenge[], BattleServiceError> {
  const { user } = useAuth();

  return useQuery<Challenge[], BattleServiceError>({
    queryKey: ['challenges', user?.id ?? null, filter],
    queryFn: () => listChallenges(filter).then(unwrap),
    enabled: user !== null,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useChallenge
//
// Fetches a single challenge by id. Always enabled — callers should only
// mount when they have a valid id (screen-level guard).
//
// Key: ['challenges', id]
// ---------------------------------------------------------------------------

export function useChallenge(
  id: string,
): UseQueryResult<Challenge | null, BattleServiceError> {
  return useQuery<Challenge | null, BattleServiceError>({
    queryKey: ['challenges', id],
    queryFn: () => getChallenge(id).then(unwrap),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useSendChallenge
//
// Mutation wrapping sendChallenge(). On success, invalidates ['challenges']
// so the outgoing list refreshes automatically.
// ---------------------------------------------------------------------------

export function useSendChallenge(): UseMutationResult<
  { challenge_id: string },
  BattleServiceError,
  SendChallengeInput
> {
  const queryClient = useQueryClient();

  return useMutation<{ challenge_id: string }, BattleServiceError, SendChallengeInput>({
    mutationFn: (input) => sendChallenge(input).then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenges'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useAcceptChallenge
//
// Mutation wrapping acceptChallenge(). On success, invalidates both
// ['challenges'] and ['battles'] — a resolved challenge produces a battle row.
// ---------------------------------------------------------------------------

export function useAcceptChallenge(): UseMutationResult<
  BattleResult,
  BattleServiceError,
  AcceptChallengeInput
> {
  const queryClient = useQueryClient();

  return useMutation<BattleResult, BattleServiceError, AcceptChallengeInput>({
    mutationFn: (input) => acceptChallenge(input).then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenges'] });
      queryClient.invalidateQueries({ queryKey: ['battles'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useBattleHistory
//
// Fetches paginated battle history for the current user.
// Query is disabled when there is no authenticated user.
//
// Key: ['battles', userId, limit]
// ---------------------------------------------------------------------------

export function useBattleHistory(
  limit = 50,
): UseQueryResult<Battle[], BattleServiceError> {
  const { user } = useAuth();

  return useQuery<Battle[], BattleServiceError>({
    queryKey: ['battles', user?.id ?? null, limit],
    queryFn: () => listBattles(limit).then(unwrap),
    enabled: user !== null,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useBattle
//
// Fetches a single battle by id (full log available on the Battle row).
// Always enabled — callers should only mount when they have a valid id.
//
// Key: ['battles', id]
// ---------------------------------------------------------------------------

export function useBattle(
  id: string,
): UseQueryResult<Battle | null, BattleServiceError> {
  return useQuery<Battle | null, BattleServiceError>({
    queryKey: ['battles', id],
    queryFn: () => getBattle(id).then(unwrap),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// BattleReplayData — returned by useBattleReplay
// ---------------------------------------------------------------------------

export type BattleReplayData = {
  battle: Battle | null;
  captureA: Capture | null;
  captureB: Capture | null;
  replay: BattleOutcome | null;
  isLoading: boolean;
  error: Error | null;
};

// ---------------------------------------------------------------------------
// useBattleReplay
//
// Composes useBattle + getCapture + simulateBattle into a single hook so
// screens are pure presentation and never import from services/ directly.
//
// The stored seed format is "{captureA.id}:{captureB.id}:{timestamp}" (set by
// the accept-challenge edge function). We parse the trailing timestamp segment
// to pass to simulateBattle, which rebuilds the identical seed internally,
// guaranteeing replay determinism.
//
// Key: ['battle-replay', battleId]
// ---------------------------------------------------------------------------

export function useBattleReplay(battleId: string): BattleReplayData {
  const { data: battle, isLoading: battleLoading, error: battleError } = useBattle(battleId);

  const replayQuery = useQuery<
    { captureA: Capture; captureB: Capture; replay: BattleOutcome },
    Error
  >({
    queryKey: ['battle-replay', battleId],
    queryFn: async () => {
      if (!battle) throw new Error('battle not loaded');

      const [resA, resB] = await Promise.all([
        getCapture(battle.capture_a),
        getCapture(battle.capture_b),
      ]);

      if (!resA.ok) throw resA.error;
      if (!resA.data) throw new Error('Could not load capture A');
      if (!resB.ok) throw resB.error;
      if (!resB.data) throw new Error('Could not load capture B');

      const captureA = resA.data;
      const captureB = resB.data;

      // Parse timestamp from seed string: "{idA}:{idB}:{timestamp}"
      const seedParts = battle.seed.split(':');
      const timestamp = Number(seedParts[seedParts.length - 1]);
      if (!Number.isFinite(timestamp)) {
        throw new Error(`useBattleReplay: unparseable seed "${battle.seed}"`);
      }

      const replay = simulateBattle(captureA.stats, captureB.stats, timestamp);
      return { captureA, captureB, replay };
    },
    enabled: battle !== null && battle !== undefined,
    staleTime: Infinity,
  });

  const isLoading = battleLoading || replayQuery.isLoading;
  const error = (battleError ?? replayQuery.error) as Error | null;

  return {
    battle: battle ?? null,
    captureA: replayQuery.data?.captureA ?? null,
    captureB: replayQuery.data?.captureB ?? null,
    replay: replayQuery.data?.replay ?? null,
    isLoading,
    error,
  };
}

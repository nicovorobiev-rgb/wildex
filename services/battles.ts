/**
 * services/battles.ts — Wildex v0.2 battles/challenges service layer.
 *
 * Allowed imports: @/engine/types, @/lib/supabase
 * No React. No hooks. All errors surfaced via Result<T>.
 *
 * Spec refs:
 *   spec/data-model.md §2.3 (battles), §2.4 (challenges), §3.2 (accept-challenge)
 *   spec/architecture.md §4 (error pattern), §9 (dependency rules)
 */

import type { Battle, BattleResult, Challenge } from '@/engine/types';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Result<T> — lightweight discriminated union for error handling.
// Mirrors the pattern in spec/architecture.md §4 without introducing a
// shared utility file (scope: R2.7 writes services/battles.ts only).
// ---------------------------------------------------------------------------

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly error: BattleServiceError };
export type Result<T> = Ok<T> | Err;

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

function err(source: string, cause: unknown): Err {
  return { ok: false, error: new BattleServiceError(source, cause) };
}

// ---------------------------------------------------------------------------
// Typed error class (spec/architecture.md §4)
// ---------------------------------------------------------------------------

export class BattleServiceError extends Error {
  constructor(
    public readonly source: string,
    public readonly cause: unknown,
  ) {
    super(
      `${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'BattleServiceError';
  }
}

// Challenge and Battle are now canonical in engine/types.ts. Re-export them
// here so any callers importing from 'services/battles' continue to resolve.
export type { Battle, Challenge } from '@/engine/types';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type SendChallengeInput = {
  opponent_id: string;
  my_capture_id: string;
  /** Not set at send time — opponent picks their capture at accept time (spec §2.9, §4.5). */
  opponent_capture_id?: never;
};

export type AcceptChallengeInput = {
  challenge_id: string;
  opponent_capture_id: string;
};

// ---------------------------------------------------------------------------
// accept-challenge Edge Function response shape (spec/data-model.md §3.2)
// ---------------------------------------------------------------------------

type AcceptChallengeResponse = {
  winner: 'a' | 'b';
  seed: string;
  log: BattleResult['log'];
  challenge_id: string;
};

// ---------------------------------------------------------------------------
// sendChallenge
//
// INSERT a new challenge row. RLS policy `challenges insert self` allows this
// when: auth.uid() = challenger_id AND opponent_id IS NULL AND winner IS NULL
// AND seed IS NULL AND opponent_stats IS NULL  (data-model.md §2.4 Phase E).
//
// The opponent_capture_id is stored as `opponent_capture` on the row so the
// opponent's capture is recorded at send-time for display; the authoritative
// capture used in the sim is re-fetched server-side at accept time.
// ---------------------------------------------------------------------------

export async function sendChallenge(
  input: SendChallengeInput,
): Promise<Result<{ challenge_id: string }>> {
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      challenger_capture: input.my_capture_id,
      opponent_id: input.opponent_id,
      // opponent_capture intentionally omitted — set by the opponent at accept time (spec §2.9).
    })
    .select('id')
    .single();

  if (error) return err('sendChallenge', error);
  return ok({ challenge_id: (data as { id: string }).id });
}

// ---------------------------------------------------------------------------
// listChallenges
//
// Returns challenges for the current user, RLS-scoped via `own challenges only`
// policy (auth.uid() = challenger_id OR auth.uid() = opponent_id).
//
// filter defaults to 'all'. The RLS policy already limits to current user;
// filter narrows on the client-visible side after the RLS-filtered result set.
// The two separate indexes on challenges(challenger_id) and
// challenges(opponent_id) (data-model.md §2.4) serve each branch efficiently.
// ---------------------------------------------------------------------------

export async function listChallenges(
  filter: 'incoming' | 'outgoing' | 'all' = 'all',
): Promise<Result<Challenge[]>> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return err('listChallenges', userError ?? new Error('not authenticated'));

  let query = supabase
    .from('challenges')
    .select('*')
    .order('created_at', { ascending: false });

  if (filter === 'outgoing') {
    query = query.eq('challenger_id', user.id);
  } else if (filter === 'incoming') {
    query = query.eq('opponent_id', user.id);
  }
  // 'all': RLS already scopes to rows where uid = challenger_id OR opponent_id.

  const { data, error } = await query;
  if (error) return err('listChallenges', error);
  return ok((data ?? []) as Challenge[]);
}

// ---------------------------------------------------------------------------
// getChallenge
// ---------------------------------------------------------------------------

export async function getChallenge(
  id: string,
): Promise<Result<Challenge | null>> {
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return err('getChallenge', error);
  return ok(data as Challenge | null);
}

// ---------------------------------------------------------------------------
// acceptChallenge
//
// Calls the `accept-challenge` Edge Function which:
//   1. Validates the caller is the opponent (not the challenger).
//   2. Re-fetches both capture stats from DB (never trusts client payload).
//   3. Runs the deterministic sim with seed = `${challenger_capture}:${opponent_capture}:${Date.now()}`.
//   4. Writes resolution to `challenges` via service role.
//
// The Edge Function expects { code, opponent_capture_id } per spec §3.2.
// The challenge_id is used to fetch the code from the challenges row first.
//
// NOTE: The Edge Function contract (spec/data-model.md §3.2) uses `code`
// (the 8-char shareable code), not the challenge UUID. We fetch the row to
// resolve the code, then invoke. If the caller already has the code in scope,
// prefer passing it directly — this two-step avoids an extra round-trip.
// ---------------------------------------------------------------------------

export async function acceptChallenge(
  input: AcceptChallengeInput,
): Promise<Result<BattleResult>> {
  // Step 1: resolve the challenge code from the id.
  const challengeResult = await getChallenge(input.challenge_id);
  if (!challengeResult.ok) return challengeResult;

  const challenge = challengeResult.value;
  if (!challenge) {
    return err('acceptChallenge', new Error(`challenge not found: ${input.challenge_id}`));
  }

  // Step 2: invoke the Edge Function, passing the opponent's chosen capture.
  // The edge function validates that opponent_capture_id belongs to the caller.
  const { data, error } = await supabase.functions.invoke<AcceptChallengeResponse>(
    'accept-challenge',
    {
      body: {
        code: challenge.code,
        opponent_capture_id: input.opponent_capture_id,
      },
    },
  );

  if (error) return err('acceptChallenge', error);
  if (!data) return err('acceptChallenge', new Error('edge function returned no data'));

  const battleResult: BattleResult = {
    winner: data.winner,
    log: data.log,
  };

  return ok(battleResult);
}

// ---------------------------------------------------------------------------
// listBattles
//
// Returns battle history for the current user. RLS policy `battles read self`
// allows rows where auth.uid() IN (player_a, player_b).
//
// Uses two OR branches to leverage the two single-column indexes added in
// data-model.md §2.3 (battles_player_a_idx, battles_player_b_idx) — a single
// composite index on (player_a, player_b) would NOT serve an OR query.
// ---------------------------------------------------------------------------

export async function listBattles(
  limit = 50,
): Promise<Result<Battle[]>> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return err('listBattles', userError ?? new Error('not authenticated'));

  const { data, error } = await supabase
    .from('battles')
    .select('*')
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return err('listBattles', error);
  return ok((data ?? []) as Battle[]);
}

// ---------------------------------------------------------------------------
// getBattle
// ---------------------------------------------------------------------------

export async function getBattle(
  id: string,
): Promise<Result<Battle | null>> {
  const { data, error } = await supabase
    .from('battles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return err('getBattle', error);
  return ok(data as Battle | null);
}

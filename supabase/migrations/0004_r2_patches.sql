-- =============================================================================
-- 0004_r2_patches.sql — Wildex v0.2 R2 loose-ends patch
-- =============================================================================
-- Closes the remaining R2 (Round-2) gaps left open after 0003_lockdown.sql:
--
--   1. accept_friendship(uuid, uuid) RPC
--      The accept-friend Edge Function (supabase/functions/accept-friend/
--      index.ts) calls admin.rpc("accept_friendship", ...) and falls back to
--      a two-write path when the RPC is missing. That fallback is racy across
--      retries (UPDATE and INSERT are not in the same transaction). This
--      migration creates the canonical SECURITY DEFINER wrapper so the Edge
--      Fn always takes the atomic path.
--
--   2. increment_inventory(uuid, text, int) RPC
--      The revenuecat-webhook Edge Function (supabase/functions/
--      revenuecat-webhook/index.ts) calls admin.rpc("increment_inventory",…)
--      and falls back to a plain upsert when missing. The fallback is NOT
--      additive — repeat purchases of the same SKU overwrite the previous
--      quantity instead of adding to it. This RPC closes that gap. The
--      migration team-needed comment block at handleInventorySku() in the
--      webhook source code spells out exactly this function body.
--
--   3. challenges.log jsonb column
--      The accept-challenge Edge Function (supabase/functions/
--      accept-challenge/index.ts) computes a full battle `log` array from
--      simulateBattle(), but the idempotent-replay branch at the top of the
--      handler returns `log: []` because the column does not yet exist.
--      Adding `log jsonb` lets a future patch persist outcome.log and serve a
--      truthful replay on the already_resolved path.
--
--   4. friendships DELETE policy broadening
--      0002_friendships.sql installed `friendships delete own` which only
--      permits auth.uid() = user_id. services/friends.ts removeFriend() needs
--      to delete BOTH symmetric rows (the user's outbound row AND the friend's
--      inbound row that mirrors it), but the current policy blocks the
--      reverse-side delete — leaving an orphan accepted row that still shows
--      up in the other party's listFriends() until they unfriend back.
--      Replaced with a policy permitting either party to delete the row.
--
-- Replayability: every drop guarded; every create uses `if not exists` or
-- `create or replace`. Wrapped in begin/commit so a mid-file failure rolls
-- back cleanly. Style matches 0001-0003 (lowercase SQL, snake_case, English
-- comments above every destructive step explaining the why).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- STEP 1 — accept_friendship RPC.
-- -----------------------------------------------------------------------------
-- Atomic accept transaction. Updates the existing pending row (requester →
-- accepter) to status='accepted' with accepted_at=now(), then inserts the
-- reverse-direction row (accepter → requester) so that
-- `select * from friendships where user_id = auth.uid()` returns the full
-- friend list with no OR/UNION (see 0002_friendships.sql table comment).
--
-- ON CONFLICT DO UPDATE on the reverse insert makes the RPC idempotent: a
-- retry after a partial-success simply re-asserts status='accepted' and the
-- same accepted_at. The function returns void; the Edge Fn re-reads the row
-- for its response body.
--
-- SECURITY DEFINER + service_role grant only: this RPC must never be callable
-- by the `authenticated` role because it bypasses the would-be-INSERT policy
-- on friendships (intentionally — friendships has no INSERT policy; only Edge
-- Fns under service role write).
create or replace function public.accept_friendship(
  p_requester uuid,
  p_accepter  uuid
) returns void
  language plpgsql security definer
  set search_path = public
as $$
begin
  -- Flip the existing pending row to accepted.
  update public.friendships
     set status      = 'accepted',
         accepted_at = now()
   where user_id   = p_requester
     and friend_id = p_accepter;

  -- Insert the reverse row so both directions exist. ON CONFLICT DO UPDATE
  -- keeps the function idempotent across retries: if the reverse row already
  -- exists (e.g. from a prior partial-success or a future double-accept), we
  -- re-assert status='accepted' and refresh accepted_at rather than erroring.
  insert into public.friendships (user_id, friend_id, status, accepted_at)
       values (p_accepter, p_requester, 'accepted', now())
  on conflict (user_id, friend_id) do update
          set status      = 'accepted',
              accepted_at = excluded.accepted_at;
end $$;

revoke all on function public.accept_friendship(uuid, uuid) from public;
grant execute on function public.accept_friendship(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- STEP 2 — increment_inventory RPC.
-- -----------------------------------------------------------------------------
-- Additive upsert into inventory keyed by (user_id, item). On a fresh row,
-- quantity := p_qty. On an existing row, quantity := quantity + p_qty (NOT
-- := p_qty — that was the bug in the webhook's fallback path that silently
-- erased repeat-purchase grants). updated_at is bumped on every call.
--
-- SECURITY DEFINER lets the webhook (service_role caller) execute this
-- without bumping into a hypothetical future RLS policy on inventory. The
-- function body is intentionally written exactly as suggested by the
-- "MIGRATION NEEDED" comment block in revenuecat-webhook/index.ts so reviewers
-- can diff the two by eye.
create or replace function public.increment_inventory(
  p_user_id uuid,
  p_item    text,
  p_qty     int
) returns void
  language sql security definer
  set search_path = public
as $$
  insert into public.inventory (user_id, item, quantity, updated_at)
       values (p_user_id, p_item, p_qty, now())
  on conflict (user_id, item) do update
          set quantity   = public.inventory.quantity + excluded.quantity,
              updated_at = now();
$$;

revoke all on function public.increment_inventory(uuid, text, int) from public;
grant execute on function public.increment_inventory(uuid, text, int) to service_role;

-- -----------------------------------------------------------------------------
-- STEP 3 — challenges.log column.
-- -----------------------------------------------------------------------------
-- accept-challenge returns outcome.log to the caller on first resolution but
-- the idempotent-replay branch hard-codes `log: []` because the column does
-- not exist yet. Adding the column unblocks a follow-up Edge Fn patch that
-- will persist outcome.log alongside seed/winner so replay returns the real
-- log instead of an empty array. Additive change; no backfill required (null
-- on pre-existing rows is the correct "we did not record this" sentinel).
alter table public.challenges
  add column if not exists log jsonb;

comment on column public.challenges.log is
  'Battle log array (jsonb) persisted by accept-challenge on resolution. '
  'NULL on pre-0004 rows (no recorded log) — clients should treat NULL as '
  '"replay unavailable, re-simulate locally with (seed)". Populated for all '
  'challenges resolved after 0004 deploys.';

-- -----------------------------------------------------------------------------
-- STEP 4 — broaden friendships DELETE policy.
-- -----------------------------------------------------------------------------
-- DESTRUCTIVE: drops the `friendships delete own` policy installed by
-- 0002_friendships.sql line 44. That policy only permitted DELETE where
-- auth.uid() = user_id, which meant services/friends.ts removeFriend() could
-- only delete its own outbound row — the inbound mirror row (where the
-- current user is friend_id) survived and kept showing the orphaned accepted
-- friendship to the other party until they too unfriended.
--
-- PRIVACY REASONING: broadening DELETE to (auth.uid() = user_id OR
-- auth.uid() = friend_id) reveals NO new information. The SELECT policy on
-- this table (`friendships read involved`, 0002_friendships.sql line 36)
-- already lets both parties read both symmetric rows — a user can already
-- see, list, and join their friend_id-side row. Allowing them to DELETE that
-- row too is symmetric with what they can already observe, and it closes the
-- orphan-row bug without leaking anything that was not already visible.
--
-- The accept-friend Edge Function continues to write both rows under service
-- role — this policy change only affects DELETE, not INSERT/UPDATE.
drop policy if exists "friendships delete own" on public.friendships;

create policy "friendships delete either side" on public.friendships
  for delete using (
        auth.uid() = user_id
     or auth.uid() = friend_id
  );

commit;

-- =============================================================================
-- Notes / spec-flags:
--
-- • accept-friend/index.ts currently calls the RPC with three named args
--   (p_requester_id, p_current_user, p_accepted_at) per its inline fallback
--   comment. This migration installs the canonical (p_requester, p_accepter)
--   signature from the R2 task spec — the Edge Fn must be updated in a
--   follow-up patch to match (drop p_accepted_at; the RPC uses now()). Until
--   that Edge Fn patch ships, the call will return PGRST202 "function not
--   found" and the function falls through to its safe two-write fallback,
--   so no user-visible regression occurs in the interim.
--
-- • increment_inventory matches the webhook's call shape exactly
--   (p_user_id uuid, p_item text, p_qty int) — no Edge Fn change needed.
--
-- • challenges.log is added but NOT populated by this migration. The
--   accept-challenge Edge Fn patch that writes outcome.log into it is a
--   separate change; this migration only unblocks that work.
--
-- • The new DELETE policy is named `friendships delete either side` (not
--   reusing the old name) so a hand-rollback that re-creates the v0.2 policy
--   would not silently leave both policies in place. If you ever need to
--   revert: drop the new policy by its new name, then re-create the original.
-- =============================================================================

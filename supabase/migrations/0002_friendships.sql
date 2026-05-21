-- 0002_friendships.sql
-- Wildex v0.2 — friendships table (data-model.md §2.5)
--
-- Friendships are stored as TWO ROWS per accepted pair (one per direction),
-- written atomically by the `accept-friend` Edge Function under service role.
-- A pending request is ONE ROW from requester → target. See comments below.
--
-- Per data-model.md §2.5 / §4 RLS coverage:
--   - SELECT: caller must be one of (user_id, friend_id)
--   - INSERT: client revoked; only `add-friend` Edge Fn (service role) writes
--   - UPDATE: client revoked; only `accept-friend` Edge Fn (service role) writes
--   - DELETE: caller may delete the side they own (auth.uid() = user_id);
--             Edge Fn deletes the reverse row on full unfriend.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists friendships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  friend_id   uuid not null references auth.users(id) on delete cascade,
  status      text not null check (status in ('pending','accepted')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- ── Indexes (data-model.md §2.5 + §8) ───────────────────────────────────────
-- PK (user_id, friend_id) serves "my outgoing friendships" cheaply.
-- This index serves the reverse direction ("who has friended me / pending").
create index if not exists friendships_friend_idx on friendships(friend_id, status);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table friendships enable row level security;

-- SELECT: a row is visible to both sides of the friendship.
do $$ begin
  create policy "friendships read involved" on friendships
    for select using (auth.uid() in (user_id, friend_id));
exception when duplicate_object then null; end $$;

-- DELETE: a user may remove the side of the friendship they own.
-- The `accept-friend` / `add-friend` Edge Fns delete the reverse row under
-- service role when a full unfriend is required.
do $$ begin
  create policy "friendships delete own" on friendships
    for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- INSERT and UPDATE are intentionally NOT defined as policies.
-- Per data-model.md §2.5 / §4, writes are service-role-only via Edge Fns:
--   - `add-friend`    inserts the initial pending row
--   - `accept-friend` updates pending → accepted AND inserts the reverse row
-- Belt-and-braces: revoke client privileges on top of "no policy" denial.
revoke insert, update on friendships from authenticated;

-- ── Table / column comments (the symmetric two-row design is surprising) ────
comment on table friendships is
  'Friend graph. SYMMETRIC PAIRS ARE STORED AS TWO ROWS — one per direction — '
  'inserted atomically by the `accept-friend` Edge Function. A pending request '
  'is a single row from requester (user_id) → target (friend_id) with '
  'status=''pending''. On accept, that row flips to ''accepted'' and the '
  'reverse-direction row is inserted in the same transaction, so '
  '`select * from friendships where user_id = auth.uid()` returns the full '
  'friend list with no OR / UNION. Clients never INSERT or UPDATE directly — '
  'see `add-friend` and `accept-friend` Edge Functions (service role).';

comment on column friendships.user_id is
  'Owner of this row — the side of the friendship that auth.uid() must equal '
  'to DELETE. For pending requests, this is the REQUESTER. For accepted '
  'friendships, both directions exist (A→B and B→A), so user_id is whichever '
  'side this row represents.';

comment on column friendships.friend_id is
  'The other party. For pending requests, this is the TARGET (who must accept).';

comment on column friendships.status is
  'pending = single row from requester→target awaiting accept. '
  'accepted = both A→B and B→A rows exist (inserted atomically by '
  '`accept-friend`).';

comment on column friendships.accepted_at is
  'Set by `accept-friend` when status flips to ''accepted''. Null while pending.';

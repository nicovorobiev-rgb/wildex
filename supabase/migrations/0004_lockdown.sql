-- =============================================================================
-- 0003_lockdown.sql — Wildex v0.2 audit lockdown migration
-- =============================================================================
-- Closes the following findings from AUDIT-SECURITY.md:
--   • Critical "Client-side INSERT on captures"            → H-sec-2  (step 1)
--   • Critical "Photo bucket privacy un-enforced"          → H-sec-3  (step 2)
--   • High     "Captures storage path leaks user UUID"     → H-sec-4  (step 6, partial — column rename only;
--                                                                       Edge Fn handles the path scheme)
--   • High     "Captures table allows client to set any col" (functional
--               fallout: growth RPCs 500) → corrected RPCs (step 5)
--   • High     "Broken composite challenges index" defense  (step 3)
--   • Medium   "grant_purchase dead code / footgun"        → M (step 9)
--
-- Spec contract: spec/data-model.md §6 "Migration Plan" — Phase A steps 4-8,
-- Phase B (growth RPCs), Phase C step 10-11, Phase D step 12, Phase E steps
-- 14-15, plus the deletion noted under "Deleted in v0.2".
--
-- This migration is DESTRUCTIVE in places (drops policies, drops functions).
-- Every destructive step is preceded by an English comment explaining the
-- audit finding it closes. All drops use `if exists`; all creates use
-- `if not exists` where the object type supports it. Policies and functions
-- are dropped before recreate so this file is replayable.
--
-- ORDERING NOTE (spec §6 Phase C): step 1 (revoke captures INSERT) is safe
-- to apply only after the `create-capture` Edge Function v0.2 is deployed.
-- The spec marks Phase C as [ORDERED]; running this migration in production
-- presumes that deploy has happened. In a fresh-clone replay (no Edge Fn
-- yet) the step still works — the schema is internally consistent — but no
-- client will be able to create captures until the function is deployed.
-- =============================================================================

begin;

-- DIAGNOSTIC: report which tables exist so we can debug the "battles missing" error.
do $$
declare
  has_battles boolean;
  has_challenges boolean;
  has_inventory boolean;
begin
  select exists (select 1 from information_schema.tables where table_schema='public' and table_name='battles') into has_battles;
  select exists (select 1 from information_schema.tables where table_schema='public' and table_name='challenges') into has_challenges;
  select exists (select 1 from information_schema.tables where table_schema='public' and table_name='inventory') into has_inventory;
  raise notice 'PRE-LOCKDOWN TABLE STATE: battles=%, challenges=%, inventory=%', has_battles, has_challenges, has_inventory;
end $$;

-- -----------------------------------------------------------------------------
-- STEP 1 — audit H-sec-2: revoke client INSERT on captures.
-- -----------------------------------------------------------------------------
-- Applies the block left commented out in supabase/schema.sql lines 277-279.
-- The "own captures insert" policy let any signed-in user INSERT rows with
-- arbitrary stats / xp / age / pending_points / allocated, sidestepping the
-- create-capture Edge Function (server-rolled stats + EXIF tier-1 anti-cheat).
-- Going forward, only the create-capture Edge Fn (service role) writes captures.
-- DESTRUCTIVE: drops the policy and revokes the grant; until create-capture
-- v0.2 is deployed, clients cannot create captures (that is the fix, not a bug).
drop policy if exists "own captures insert" on public.captures;
revoke insert on public.captures from authenticated;

-- -----------------------------------------------------------------------------
-- STEP 2 — audit H-sec-3: privatize the captures Storage bucket.
-- -----------------------------------------------------------------------------
-- The captures bucket was created public in earlier deploys (see schema.sql
-- lines 76-78). Storage RLS policies (schema.sql 254-273) only apply to
-- private buckets — a public bucket bypasses them entirely, leaking every
-- capture photo to anyone who can guess the storage path. Spec §5.1 promotes
-- privatization from a manual dashboard step to a hard migration assertion.
update storage.buckets set public = false where id = 'captures';

-- Loud assertion: error out the migration if the bucket is missing OR still
-- public after the update. Spec §5.1 paragraph 1.
do $$
declare
  is_public boolean;
begin
  select public into is_public from storage.buckets where id = 'captures';
  if is_public is null then
    raise exception 'audit H-sec-3: storage bucket "captures" does not exist — create it (private) before running this migration';
  end if;
  if is_public then
    raise exception 'audit H-sec-3: storage bucket "captures" is still public after update — refusing to proceed';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- STEP 3 — audit fix: replace broken composite challenges index.
-- -----------------------------------------------------------------------------
-- DESTRUCTIVE: drops challenges_players_idx because it is the (challenger_id,
-- opponent_id) composite from schema.sql:64, which cannot serve the
-- .or(challenger_id.eq.x, opponent_id.eq.x) query at lib/multiplayer.ts:89
-- (Postgres only uses the leading column of a composite for non-equality on
-- the second). Replaced with two single-column partial indexes per spec §2.4
-- and §8 ("Audit fix").
drop index if exists public.challenges_players_idx;

create index if not exists challenges_challenger_idx
  on public.challenges (challenger_id, created_at desc);
create index if not exists challenges_opponent_idx
  on public.challenges (opponent_id, created_at desc)
  where opponent_id is not null;

-- -----------------------------------------------------------------------------
-- STEP 4 — additive indexes from spec §8.
-- -----------------------------------------------------------------------------
-- battles_player_a_idx / battles_player_b_idx (spec §2.3): "battles where I'm
-- a OR b" needs two single-column composites, not one.
create index if not exists battles_player_a_idx
  on public.battles (player_a, created_at desc);
create index if not exists battles_player_b_idx
  on public.battles (player_b, created_at desc);

-- captures_user_age_idx (spec §2.2): grow screen sorts by oldest/most-leveled.
create index if not exists captures_user_age_idx
  on public.captures (user_id, age desc);

-- challenges_open_idx (spec §2.4): server-side sweep for abandoned open codes.
create index if not exists challenges_open_idx
  on public.challenges (created_at desc)
  where opponent_id is null;

-- -----------------------------------------------------------------------------
-- STEP 5 — audit High "broken growth RPCs": drop + recreate with corrected
-- signatures matching lib/growth.ts call sites.
-- -----------------------------------------------------------------------------
-- DESTRUCTIVE: drops the three existing growth functions (schema.sql lines
-- 117-177). Their argument names (p_capture_id) and arities do not match the
-- client wrappers in lib/growth.ts:58-85, so every feed/age-up/allocate call
-- 500s today. Spec §6 Phase B: "update schema-side to match the client call
-- sites" — feed_capture(p_capture, p_xp, p_item),
-- age_up(p_capture, p_use_tonic), allocate_point(p_capture, p_stat, p_amount).

drop function if exists public.feed_capture(text);
drop function if exists public.feed_capture(text, int, text);

create or replace function public.feed_capture(
  p_capture text,
  p_xp      int,
  p_item    text
) returns public.captures
  language plpgsql security definer
  set search_path = public
as $$
declare
  c        public.captures;
  v_xp     int := p_xp;
  v_inv    int;
begin
  -- ownership + lock
  select * into c from public.captures
    where id = p_capture and user_id = auth.uid()
    for update;
  if not found then raise exception 'capture not found or not yours'; end if;

  -- clamp p_xp to [1, 50] (spec §6 Phase B comment "clamp p_xp ∈ [1,50]")
  if v_xp is null or v_xp < 1 then v_xp := 1; end if;
  if v_xp > 50 then v_xp := 50; end if;

  -- p_item: null (free berry feed) or 'growth_treat'. Reject anything else.
  if p_item is not null and p_item <> 'growth_treat' then
    raise exception 'unknown feed item: %', p_item;
  end if;

  -- if a growth_treat is being consumed, require + decrement inventory.
  if p_item = 'growth_treat' then
    select quantity into v_inv from public.inventory
      where user_id = auth.uid() and item = 'growth_treat'
      for update;
    if v_inv is null or v_inv < 1 then
      raise exception 'no growth_treat in inventory';
    end if;
    update public.inventory
       set quantity   = quantity - 1,
           updated_at = now()
     where user_id = auth.uid() and item = 'growth_treat';
  end if;

  update public.captures
     set xp = xp + v_xp
   where id = c.id
   returning * into c;
  return c;
end $$;
revoke all on function public.feed_capture(text, int, text) from public;
grant execute on function public.feed_capture(text, int, text) to authenticated;

drop function if exists public.age_up(text);
drop function if exists public.age_up(text, boolean);

create or replace function public.age_up(
  p_capture    text,
  p_use_tonic  boolean
) returns public.captures
  language plpgsql security definer
  set search_path = public
as $$
declare
  c     public.captures;
  cost  int;
  v_inv int;
begin
  select * into c from public.captures
    where id = p_capture and user_id = auth.uid()
    for update;
  if not found then raise exception 'capture not found or not yours'; end if;

  -- spec §6 Phase B: enforce age < 10
  if c.age >= 10 then raise exception 'capture is already max age'; end if;

  -- spec §6 Phase B: cost = floor(60 * power(age, 1.3)) — mirrors
  -- lib/growth.ts:33 xpToNextAge(), server-authoritative.
  cost := greatest(1, floor(60 * power(c.age, 1.3))::int);

  if coalesce(p_use_tonic, false) then
    -- tonic instantly ages up; require + decrement inventory.
    select quantity into v_inv from public.inventory
      where user_id = auth.uid() and item = 'age_tonic'
      for update;
    if v_inv is null or v_inv < 1 then
      raise exception 'no age_tonic in inventory';
    end if;
    update public.inventory
       set quantity   = quantity - 1,
           updated_at = now()
     where user_id = auth.uid() and item = 'age_tonic';
  else
    if c.xp < cost then
      raise exception 'insufficient xp (% < %)', c.xp, cost;
    end if;
  end if;

  update public.captures
     set xp             = case when coalesce(p_use_tonic, false) then xp else xp - cost end,
         age            = age + 1,
         pending_points = pending_points + 5            -- spec §6 Phase B comment "+ 5"
   where id = c.id
   returning * into c;
  return c;
end $$;
revoke all on function public.age_up(text, boolean) from public;
grant execute on function public.age_up(text, boolean) to authenticated;

drop function if exists public.allocate_point(text, text);
drop function if exists public.allocate_point(text, text, int);

create or replace function public.allocate_point(
  p_capture text,
  p_stat    text,
  p_amount  int
) returns public.captures
  language plpgsql security definer
  set search_path = public
as $$
declare
  c       public.captures;
  v_amt   int := coalesce(p_amount, 1);
  i       int;
begin
  if p_stat not in ('hp','attack','defense','speed','special') then
    raise exception 'invalid stat';
  end if;
  if v_amt < 1 then raise exception 'p_amount must be >= 1'; end if;

  select * into c from public.captures
    where id = p_capture and user_id = auth.uid()
    for update;
  if not found then raise exception 'capture not found or not yours'; end if;

  if c.pending_points < v_amt then
    raise exception 'not enough pending_points (% < %)', c.pending_points, v_amt;
  end if;

  -- spec §6 Phase B: loop allocate (+2 stat, +1 allocated) per point.
  for i in 1..v_amt loop
    update public.captures set
      pending_points = pending_points - 1,
      stats          = jsonb_set(
                         stats,
                         array[p_stat],
                         to_jsonb(coalesce((stats->>p_stat)::int, 0) + 2)
                       ),
      allocated      = jsonb_set(
                         allocated,
                         array[p_stat],
                         to_jsonb(coalesce((allocated->>p_stat)::int, 0) + 1)
                       )
     where id = c.id
     returning * into c;
  end loop;

  return c;
end $$;
revoke all on function public.allocate_point(text, text, int) from public;
grant execute on function public.allocate_point(text, text, int) to authenticated;

-- -----------------------------------------------------------------------------
-- STEP 6 — audit H (storage path semantics): rename captures.image_url →
-- captures.image_path.
-- -----------------------------------------------------------------------------
-- Spec §6 Phase C step 11. The column stores a Storage path (not a URL — see
-- AUDIT-ARCHITECTURE ADR #4). Rename is metadata-only and idempotent (guard
-- with information_schema so replay is safe).
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'captures'
       and column_name  = 'image_url'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'captures'
       and column_name  = 'image_path'
  ) then
    alter table public.captures rename column image_url to image_path;
  end if;
end $$;

comment on column public.captures.image_path is
  'Supabase Storage path under the "captures" bucket (e.g. ${user.id}/${capture.id}.jpg). Not a URL — call signCaptureUrl() in lib/storage.ts to mint a short-TTL signed URL for display.';

-- -----------------------------------------------------------------------------
-- STEP 7 — captures column constraints (spec §2.2 / §6 Phase A step 8).
-- -----------------------------------------------------------------------------
-- Add as NOT VALID then VALIDATE so existing rows do not block the migration
-- (spec explicitly calls out "to avoid full-table lock"). Each constraint is
-- guarded so replay is idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.captures'::regclass
       and conname  = 'captures_taxon_id_range_chk'
  ) then
    alter table public.captures
      add constraint captures_taxon_id_range_chk
      check (taxon_id > 0 and taxon_id < 1000000000) not valid;
  end if;
end $$;
alter table public.captures validate constraint captures_taxon_id_range_chk;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.captures'::regclass
       and conname  = 'captures_score_range_chk'
  ) then
    alter table public.captures
      add constraint captures_score_range_chk
      check (score >= 0 and score <= 1) not valid;
  end if;
end $$;
alter table public.captures validate constraint captures_score_range_chk;

-- The existing `age >= 1` check (schema.sql:93) stays; here we ADD the upper
-- bound `age <= 10` as its own constraint per spec §2.2 ("age int ... check
-- (age >= 1 and age <= 10)") and §6 Phase A step 8 ("age upper bound (≤ 10)").
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.captures'::regclass
       and conname  = 'captures_age_max_chk'
  ) then
    alter table public.captures
      add constraint captures_age_max_chk
      check (age <= 10) not valid;
  end if;
end $$;
alter table public.captures validate constraint captures_age_max_chk;

-- -----------------------------------------------------------------------------
-- STEP 8 — challenges: tighten INSERT policy, add DELETE policy, add
-- resolved_at column.
-- -----------------------------------------------------------------------------
-- Add resolved_at (spec §2.4 "plus one new column resolved_at timestamptz, set
-- by accept-challenge so clients can filter unresolved efficiently").
alter table public.challenges
  add column if not exists resolved_at timestamptz;

-- DESTRUCTIVE: drop the existing "challenges insert self" policy (schema.sql
-- lines 70-71). The original only checks auth.uid() = challenger_id, letting
-- a challenger pre-fill opponent_id / winner / seed / opponent_stats and
-- bypass the accept-challenge Edge Fn. Spec §2.4 and §6 Phase E step 14
-- tighten the WITH CHECK to reject pre-filled resolution columns.
drop policy if exists "challenges insert self" on public.challenges;
create policy "challenges insert self" on public.challenges
  for insert with check (
        auth.uid() = challenger_id
    and opponent_id     is null
    and winner          is null
    and seed            is null
    and opponent_stats  is null
  );

-- Spec §2.4 / §6 Phase E step 15: challenger can cancel a still-open challenge.
drop policy if exists "challenges delete own open" on public.challenges;
create policy "challenges delete own open" on public.challenges
  for delete using (
        auth.uid() = challenger_id
    and opponent_id is null
  );

-- -----------------------------------------------------------------------------
-- STEP 9 — audit Medium "grant_purchase dead-code / footgun": drop the
-- function entirely.
-- -----------------------------------------------------------------------------
-- DESTRUCTIVE: grant_purchase (schema.sql:182-197) is never called — the
-- RevenueCat webhook writes inventory directly under service role — and would
-- crash if invoked because auth.uid() is NULL under service_role while
-- inventory.user_id is NOT NULL. Spec §6 "Deleted in v0.2: grant_purchase()".
drop function if exists public.grant_purchase(text, int, text);

commit;

-- =============================================================================
-- Ambiguities / spec-flags (none blocking, all resolved by spec text):
--
-- • The data-model.md spec for feed_capture says "clamp p_xp ∈ [1,50]; reject
--   unknown p_item (allowed: null, 'growth_treat'); if 'growth_treat'
--   decrement inventory; update xp = xp + p_xp; return updated row." I
--   implemented that literally. Note that lib/growth.ts passes p_item =
--   'berry' coerced to null and 'growth_treat' as-is, and passes FEED_XP
--   values 25 (berry) / 38 (growth_treat) — both within the [1,50] clamp.
--
-- • Spec age_up says "+= 5" for pending_points; schema.sql:148 previously did
--   "+= 1". I follow the spec (+= 5). This matches "POINTS_PER_AGE_UP = 5" in
--   lib/growth.ts:13.
--
-- • allocate_point in the spec describes "loop allocate (+2 stat, +1
--   allocated)". The existing schema.sql:169-172 did exactly that per single
--   call (no p_amount). I loop 1..p_amount as spec dictates.
--
-- • Spec §6 Phase D step 13 ("CI assertion that fails deploy if public flips
--   true") is OUT OF SCOPE for this SQL migration — it's a separate CI task.
--   The migration-time loud assertion at STEP 2 is the in-band equivalent.
--
-- • Spec §5.1 also notes an `insert into storage.buckets ... on conflict do
--   update` form for cases where the bucket doesn't exist yet. STEP 2 instead
--   raises if the bucket is missing — this migration assumes the bucket
--   already exists (the Wildex production project has had one since v0.1).
--   If you need to bootstrap a brand-new project, run the insert form first.
-- =============================================================================

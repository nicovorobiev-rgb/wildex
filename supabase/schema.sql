-- Wildex schema. Run in Supabase SQL editor.

create extension if not exists "uuid-ossp";

create table if not exists captures (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  taxon_id bigint not null,
  common_name text not null,
  scientific_name text not null,
  score real not null,
  stats jsonb not null,
  lat double precision,
  lng double precision,
  image_url text,
  created_at timestamptz not null default now()
);

create index if not exists captures_user_idx on captures(user_id, created_at desc);
create index if not exists captures_taxon_idx on captures(taxon_id);

alter table captures enable row level security;

create policy "own captures read" on captures
  for select using (auth.uid() = user_id);
create policy "own captures insert" on captures
  for insert with check (auth.uid() = user_id);
create policy "own captures delete" on captures
  for delete using (auth.uid() = user_id);

-- Battles: server-recorded results, replayable from (a, b, seed).
create table if not exists battles (
  id uuid primary key default uuid_generate_v4(),
  player_a uuid not null references auth.users(id) on delete cascade,
  player_b uuid not null references auth.users(id) on delete cascade,
  capture_a text not null references captures(id),
  capture_b text not null references captures(id),
  seed text not null,
  winner char(1) not null check (winner in ('a','b')),
  created_at timestamptz not null default now()
);

alter table battles enable row level security;
create policy "battles read self" on battles
  for select using (auth.uid() in (player_a, player_b));

-- Challenges: async multiplayer. Challenger opens with a code; opponent
-- accepts, server records both stat blocks + seed + winner.
create table if not exists challenges (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  challenger_id uuid not null references auth.users(id) on delete cascade,
  challenger_capture text not null references captures(id) on delete cascade,
  challenger_stats jsonb not null,
  opponent_id uuid references auth.users(id) on delete cascade,
  opponent_capture text references captures(id) on delete cascade,
  opponent_stats jsonb,
  seed text,
  winner char(1) check (winner in ('a','b')),
  created_at timestamptz not null default now()
);

create index if not exists challenges_code_idx on challenges(code);
create index if not exists challenges_players_idx on challenges(challenger_id, opponent_id);

alter table challenges enable row level security;

create policy "challenges read involved" on challenges
  for select using (auth.uid() in (challenger_id, opponent_id) or opponent_id is null);
create policy "challenges insert self" on challenges
  for insert with check (auth.uid() = challenger_id);
create policy "challenges accept" on challenges
  for update using (opponent_id is null and auth.uid() <> challenger_id)
  with check (auth.uid() = opponent_id);

-- Storage: a public-read bucket for capture photos.
-- Create via dashboard: name "captures", public.
-- Or run: insert into storage.buckets (id, name, public) values ('captures','captures',true);


-- =============================================================================
-- 2026-05-19 — CRITICAL SECURITY MIGRATIONS (from AUDIT-SECURITY.md)
-- =============================================================================
-- APPLY IN COORDINATION with the Edge Functions in supabase/functions/. Some
-- changes here intentionally break the current insecure client flow until the
-- corresponding Edge Function is deployed — that is the fix, not an oversight.

-- ── C-sec-4 — missing tables/columns the app already queries (was created via
--             dashboard out-of-band; promoting to schema for review).
alter table captures
  add column if not exists xp int not null default 0,
  -- age MUST default to 1 (researcher M10: age=0 → xpToNextAge=0 → divide-by-zero in grow.tsx)
  add column if not exists age int not null default 1 check (age >= 1),
  add column if not exists pending_points int not null default 0,
  add column if not exists allocated jsonb not null default '{}'::jsonb;

create table if not exists inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  quantity int not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, item)
);

alter table inventory enable row level security;

create policy "inventory read self" on inventory
  for select using (auth.uid() = user_id);

-- Writes to inventory go through SECURITY DEFINER functions or the
-- RevenueCat webhook Edge Function (service role) — never direct client writes.
revoke insert, update, delete on inventory from authenticated;

-- ── C-sec-4 — growth RPCs as SECURITY DEFINER. App calls supabase.rpc()
--             directly; auth.uid() must be checked SERVER-side because the
--             client passes the capture_id.
create or replace function feed_capture(p_capture_id text)
  returns captures language plpgsql security definer
  set search_path = public
as $$
declare c captures;
begin
  select * into c from captures
    where id = p_capture_id and user_id = auth.uid()
    for update;
  if not found then raise exception 'capture not found or not yours'; end if;
  update captures set xp = xp + 10 where id = c.id returning * into c;
  return c;
end $$;
revoke all on function feed_capture(text) from public;
grant execute on function feed_capture(text) to authenticated;

create or replace function age_up(p_capture_id text)
  returns captures language plpgsql security definer
  set search_path = public
as $$
declare c captures; cost int;
begin
  select * into c from captures
    where id = p_capture_id and user_id = auth.uid()
    for update;
  if not found then raise exception 'capture not found or not yours'; end if;
  cost := greatest(1, floor(60 * power(c.age, 1.3))::int);   -- mirrors lib/growth.ts xpToNextAge, server-authoritative
  if c.xp < cost then raise exception 'insufficient xp (% < %)', c.xp, cost; end if;
  update captures set
    xp = xp - cost,
    age = age + 1,
    pending_points = pending_points + 1
   where id = c.id returning * into c;
  return c;
end $$;
revoke all on function age_up(text) from public;
grant execute on function age_up(text) to authenticated;

create or replace function allocate_point(p_capture_id text, p_stat text)
  returns captures language plpgsql security definer
  set search_path = public
as $$
declare c captures;
begin
  if p_stat not in ('hp','attack','defense','speed','special') then
    raise exception 'invalid stat';
  end if;
  select * into c from captures
    where id = p_capture_id and user_id = auth.uid()
    for update;
  if not found then raise exception 'capture not found or not yours'; end if;
  if c.pending_points <= 0 then raise exception 'no points to allocate'; end if;
  update captures set
    pending_points = pending_points - 1,
    stats = jsonb_set(stats, array[p_stat], to_jsonb(coalesce((stats->>p_stat)::int,0) + 2)),
    allocated = jsonb_set(allocated, array[p_stat], to_jsonb(coalesce((allocated->>p_stat)::int,0) + 1))
   where id = c.id returning * into c;
  return c;
end $$;
revoke all on function allocate_point(text, text) from public;
grant execute on function allocate_point(text, text) to authenticated;

-- ── C-sec-5 — grant_purchase: NO client execute. The IAP "receipt" the client
--             passes is just a SKU string — not validated. Real grants come
--             from the RevenueCat webhook Edge Function (service role).
create or replace function grant_purchase(p_item text, p_qty int, p_receipt text)
  returns void language plpgsql security definer
  set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'grant_purchase is server-only — IAP grants come from the RevenueCat webhook';
  end if;
  insert into inventory (user_id, item, quantity)
  values (auth.uid(), p_item, p_qty)
  on conflict (user_id, item) do update set
    quantity = inventory.quantity + excluded.quantity,
    updated_at = now();
end $$;
revoke all on function grant_purchase(text, int, text) from public;
-- intentionally NO grant to authenticated.

-- ── C-sec-3 — trigger restricts which columns the opponent can set on accept.
--             The existing "challenges accept" RLS policy lets the opponent
--             update ANY column; this trigger denies winner/stats/seed writes
--             from non-service-role callers. accept-challenge Edge Function
--             runs as service_role and bypasses the check.
create or replace function protect_challenge_resolution()
  returns trigger language plpgsql
  set search_path = public
as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.winner             is distinct from old.winner
     or new.opponent_stats     is distinct from old.opponent_stats
     or new.seed               is distinct from old.seed
     or new.challenger_stats   is distinct from old.challenger_stats
     or new.challenger_capture is distinct from old.challenger_capture
     or new.challenger_id      is distinct from old.challenger_id
     or new.code               is distinct from old.code then
    raise exception 'these columns are server-resolved only — call the accept-challenge Edge Function';
  end if;
  return new;
end $$;

drop trigger if exists protect_challenge_resolution on challenges;
create trigger protect_challenge_resolution
  before update on challenges
  for each row execute function protect_challenge_resolution();

-- ── C-sec-1 + C-sec-2 + H2 — enforce server-side capture creation.
-- IMPORTANT: do NOT apply these two lines until create-capture Edge Function
-- (supabase/functions/create-capture) is deployed. Until then, the app cannot
-- save new captures. Uncomment in coordination with the function deploy.
-- drop policy if exists "own captures insert" on captures;
-- revoke insert on captures from authenticated;

-- ── C-sec-5 — RevenueCat webhook idempotency. RC retries; dedupe by event_id.
create table if not exists rc_events (
  event_id text primary key,
  type text not null,
  product_id text,
  app_user_id text,
  processed_at timestamptz not null default now()
);
alter table rc_events enable row level security;  -- no policies: service-role-only.

-- ── 2026-05-19 — HIGH SEC: server-side capture creation + Storage RLS ──
-- Apply AFTER deploying `supabase functions deploy create-capture`. Then:
--   1. Set the 'captures' bucket to PRIVATE in the Supabase dashboard.
--   2. Run the storage policies below.
--   3. Uncomment the revoke + drop-policy block to lock client-side INSERT.
-- Order matters — if you revoke before deploying the function, captures break.

-- Storage RLS on the 'captures' bucket. Closes audit H-sec-3 (public photos)
-- and H-sec-4 (cross-user overwrite). Bucket MUST be private — public-bucket
-- reads bypass these policies entirely. Folder-namespaced by auth.uid().
do $$ begin
  create policy "captures select own folder" on storage.objects for select
    using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "captures insert own folder" on storage.objects for insert
    with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "captures update own folder" on storage.objects for update
    using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "captures delete own folder" on storage.objects for delete
    using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

-- AFTER `supabase functions deploy create-capture` succeeds, run the block
-- below to revoke client-side INSERT on captures (closes audit H-sec-2):
--
--   drop policy if exists "own captures insert" on captures;
--   revoke insert on captures from authenticated;
--
-- (Leaving commented so the schema is replayable from scratch; uncomment
--  manually in the dashboard once create-capture is live.)

-- ── 2026-05-19 — MEDIUM SEC: M2 — tighten challenges SELECT policy.
-- Old policy let any authenticated user SELECT open challenges (opponent_id is
-- null) → attackers could enumerate friend codes. Combined with accept-challenge
-- now taking `code` server-side (under service role), the wider SELECT is no
-- longer needed.
drop policy if exists "challenges read involved" on challenges;
create policy "own challenges only" on challenges
  for select using (auth.uid() = challenger_id or auth.uid() = opponent_id);

-- (Optional — also tighten the UPDATE policy. The protect_challenge_resolution
-- trigger above already restricts what columns are writable from non-service-role,
-- and lib/multiplayer.ts no longer UPDATEs directly, so this is defense-in-depth.)
-- drop policy if exists "challenges accept" on challenges;

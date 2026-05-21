-- =============================================================================
-- 0003_complete_v01_schema.sql — Backfill missing v0.1 tables.
-- =============================================================================
-- The v0.1 schema.sql was only partially applied in production. Specifically,
-- `battles` was never created, even though `captures`, `challenges`, and
-- `inventory` were. This migration backfills `battles` (and idempotently
-- ensures the others exist) so 0004_lockdown.sql can create indexes on it.
-- Uses gen_random_uuid() (built-in to Postgres 13+, available on Supabase).
-- =============================================================================

begin;

-- ── battles (the actually-missing one) ───────────────────────────────────
create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  player_a uuid not null references auth.users(id) on delete cascade,
  player_b uuid not null references auth.users(id) on delete cascade,
  capture_a text not null references public.captures(id),
  capture_b text not null references public.captures(id),
  seed text not null,
  winner char(1) not null check (winner in ('a','b')),
  created_at timestamptz not null default now()
);

alter table public.battles enable row level security;

do $$ begin
  create policy "battles read self" on public.battles
    for select using (auth.uid() in (player_a, player_b));
exception when duplicate_object then null; end $$;

-- ── challenges (no-op if exists) ─────────────────────────────────────────
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  challenger_id uuid not null references auth.users(id) on delete cascade,
  challenger_capture text not null references public.captures(id) on delete cascade,
  challenger_stats jsonb not null,
  opponent_id uuid references auth.users(id) on delete cascade,
  opponent_capture text references public.captures(id) on delete cascade,
  opponent_stats jsonb,
  seed text,
  winner char(1) check (winner in ('a','b')),
  created_at timestamptz not null default now()
);

alter table public.challenges enable row level security;

-- ── captures: ensure v0.1 columns exist ──────────────────────────────────
alter table public.captures
  add column if not exists xp int not null default 0,
  add column if not exists age int not null default 1 check (age >= 1),
  add column if not exists pending_points int not null default 0,
  add column if not exists allocated jsonb not null default '{}'::jsonb;

-- ── inventory (no-op if exists) ──────────────────────────────────────────
create table if not exists public.inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  quantity int not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, item)
);

alter table public.inventory enable row level security;

-- ── storage bucket (private) ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('captures', 'captures', false)
  on conflict (id) do nothing;

commit;

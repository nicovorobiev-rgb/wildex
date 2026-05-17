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

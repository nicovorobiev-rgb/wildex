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

-- Storage: a public-read bucket for capture photos.
-- Create via dashboard: name "captures", public.

# Wildex v0.2 — Data Model Spec

_Status: frozen for v0.2 build. Other agents code to this._
_Owner: data model lead._
_Source baseline: `supabase/schema.sql` as of 2026-05-19._

Freezes the v0.2 Supabase schema, Edge Function contracts, RLS surface, and
the migration from current → v0.2. Existing Supabase project is **kept** —
all changes are additive or targeted fixes. v0.3+ items (liveness, GPS
validation, push, daily quests, subs, leaderboards) are out of scope.

---

## 1. Entity Diagram

```
auth.users (Supabase-managed)
    │
    │ 1:1
    ▼
profiles (NEW v0.2)
    │  user_id PK/FK → auth.users.id
    │  friend_code (unique, 8-char)
    │  display_name, is_pro, created_at
    │
    │ 1:N
    ▼
captures
    │  id (text/UUID PK, server-issued)
    │  user_id FK → auth.users.id
    │  taxon_id, common_name, scientific_name, score
    │  stats (JSONB), xp, age, pending_points, allocated (JSONB)
    │  lat, lng, image_path (renamed from image_url), created_at
    │
    ├──< battles
    │       id, player_a, player_b
    │       capture_a FK → captures.id
    │       capture_b FK → captures.id
    │       seed, winner ('a'|'b'), created_at
    │
    ├──< challenges
    │       id, code (unique 8-char)
    │       challenger_id FK → auth.users.id
    │       challenger_capture FK → captures.id
    │       challenger_stats (JSONB)
    │       opponent_id FK → auth.users.id (nullable)
    │       opponent_capture FK → captures.id (nullable)
    │       opponent_stats (JSONB, nullable)
    │       seed, winner, created_at, resolved_at
    │
    └──< (referenced by) friendships (NEW v0.2)
              user_id FK → auth.users.id
              friend_id FK → auth.users.id
              status ('pending'|'accepted')
              created_at, accepted_at

inventory (user_id, item) PK
    user_id FK → auth.users.id, quantity, updated_at

rc_events (event_id PK)
    type, product_id, app_user_id, processed_at

storage.buckets['captures']  (private)
    objects keyed by  ${user.id}/${capture.id}.jpg
```

Notes:
- `profiles` holds `friend_code` + `is_pro` (no separate `friend_codes` table —
  one code per user).
- `friendships` stores accepted connections. Friendship is **not required** to
  challenge in v0.2 (codes are shareable); it's the hook for v0.3 push.
- All FKs cascade from `auth.users` per existing schema.

---

## 2. Table Specs

### 2.1 `profiles` (NEW)

```sql
create table if not exists profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  friend_code  text not null unique,
  display_name text,
  is_pro       boolean not null default false,
  pro_until    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_friend_code_idx on profiles(friend_code);
alter table profiles enable row level security;
```

**Friend code generation.** Reuse the 8-char crypto alphabet from
`lib/multiplayer.ts:26` (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`). SQL function
`generate_friend_code()` loops until unique (collisions ~1 in 10^12).
Backfill existing users with `on conflict do nothing`.

Policies (clients never enumerate friend codes — that's server-side):

```sql
create policy "profiles read own" on profiles
  for select using (auth.uid() = user_id);
create policy "profiles update own basic" on profiles
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
revoke insert on profiles from authenticated;
revoke update (friend_code, is_pro, pro_until) on profiles from authenticated;
```

| Op | Policy | Logic |
|---|---|---|
| SELECT | `profiles read own` | `auth.uid() = user_id`. Friend-code lookup is service-role-only via `add-friend` Edge Fn. |
| INSERT | none | Inserted by `handle_new_user()` trigger on auth signup; client INSERT revoked. |
| UPDATE | `profiles update own basic` | `auth.uid() = user_id`. Column-level revoke locks `friend_code`/`is_pro`/`pro_until` to server. |
| DELETE | none | Cascade from `auth.users`. |

### 2.2 `captures` (EXISTING — kept, locked down)

Columns from `schema.sql:5-17` + `schema.sql:90-95` stay. **Rename** `image_url`
→ `image_path` (it stores a Storage path, not a URL — AUDIT-ARCHITECTURE ADR #4).

```sql
-- post-migration shape
captures (
  id              text primary key,            -- server UUIDv4 from create-capture
  user_id         uuid not null references auth.users(id) on delete cascade,
  taxon_id        bigint not null check (taxon_id > 0 and taxon_id < 1000000000),
  common_name     text not null,
  scientific_name text not null,
  score           real not null check (score >= 0 and score <= 1),
  stats           jsonb not null,
  xp              int not null default 0 check (xp >= 0),
  age             int not null default 1 check (age >= 1 and age <= 10),
  pending_points  int not null default 0 check (pending_points >= 0),
  allocated       jsonb not null default '{}'::jsonb,
  lat             double precision,
  lng             double precision,
  image_path      text,                        -- RENAMED from image_url
  created_at      timestamptz not null default now()
)
```

Indexes (existing + new):

```sql
create index captures_user_idx     on captures(user_id, created_at desc);  -- existing
create index captures_taxon_idx    on captures(taxon_id);                  -- existing
create index captures_user_age_idx on captures(user_id, age desc);         -- new: grow screen sort
```

Policies:

| Op | Policy | Logic |
|---|---|---|
| SELECT | `captures read own` | `auth.uid() = user_id`. **Deliberately private** — no public dex in v0.2. |
| INSERT | none (revoked) | `revoke insert on captures from authenticated` — only `create-capture` Edge Fn (service role) writes. |
| UPDATE | none | Implicitly denied for clients. **Document with `comment on table`.** Growth writes go via `feed_capture` / `age_up` / `allocate_point` SECURITY DEFINER RPCs. |
| DELETE | `captures delete own` | `auth.uid() = user_id` — players can prune their own dex. |

### 2.3 `battles` (EXISTING — kept, INSERT clarified)

Schema unchanged from `schema.sql:32-41`. v0.2 does not write to `battles`
from the client; only `accept-challenge` writes via service role.

| Op | Policy | Logic |
|---|---|---|
| SELECT | `battles read self` | `auth.uid() in (player_a, player_b)`. |
| INSERT/UPDATE/DELETE | none | Service-role only. Document with `comment on table`. |

Indexes:

```sql
create index battles_player_a_idx on battles(player_a, created_at desc);
create index battles_player_b_idx on battles(player_b, created_at desc);
```

(Audit fix — two single-column indexes serve "battles where I'm a OR b"
better than a composite that can only be used in column-order.)

### 2.4 `challenges` (EXISTING — kept, indexes fixed)

Schema from `schema.sql:49-61` plus one new column `resolved_at timestamptz`,
set by `accept-challenge` so clients can filter unresolved efficiently.

Indexes — fix audit issue (composite `(challenger_id, opponent_id)` cannot
serve `.or(challenger_id.eq, opponent_id.eq)`):

```sql
drop  index if exists challenges_players_idx;            -- the broken one
create index challenges_code_idx       on challenges(code);
create index challenges_challenger_idx on challenges(challenger_id, created_at desc);
create index challenges_opponent_idx   on challenges(opponent_id, created_at desc)
  where opponent_id is not null;
create index challenges_open_idx       on challenges(created_at desc) where opponent_id is null;
```

Policies (post-migration, from `schema.sql:289-291`):

| Op | Policy | Logic |
|---|---|---|
| SELECT | `own challenges only` | `auth.uid() = challenger_id OR auth.uid() = opponent_id`. **Open challenges are not enumerable** — accept by code goes through Edge Fn. |
| INSERT | `challenges insert self` | `with check (auth.uid() = challenger_id AND opponent_id IS NULL AND winner IS NULL AND seed IS NULL AND opponent_stats IS NULL)` — tightened from existing (deny prefilling resolution fields). |
| UPDATE | `challenges accept` | Existing policy stays, gated by `protect_challenge_resolution` trigger (`schema.sql:204-225`). In v0.2 we additionally **tighten to specific columns** — see migration plan §6. |
| DELETE | `challenges delete own open` | `auth.uid() = challenger_id AND opponent_id IS NULL` — challenger can cancel before acceptance. |

### 2.5 `friendships` (NEW)

```sql
create table if not exists friendships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  friend_id   uuid not null references auth.users(id) on delete cascade,
  status      text not null check (status in ('pending','accepted')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create index friendships_friend_idx on friendships(friend_id, status);
alter table friendships enable row level security;
```

Symmetric but stored as **two rows** (one per direction) on accept, written
atomically by `accept-friend` under service role. Pending = one row from
requester → target.

| Op | Policy | Logic |
|---|---|---|
| SELECT | `friendships read involved` | `auth.uid() IN (user_id, friend_id)`. |
| INSERT | none (revoked) | Service-role only via `add-friend` Edge Fn (which resolves friend code → uuid). |
| UPDATE | none (revoked) | Service-role only via `accept-friend` Edge Fn. |
| DELETE | `friendships delete own` | `auth.uid() = user_id` — user can remove the side they own; Edge Fn deletes the reverse on full unfriend. |

### 2.6 `inventory` (EXISTING — unchanged)

From `schema.sql:97-103`. SELECT-only for clients (`schema.sql:107-108`);
writes revoked from `authenticated` (`schema.sql:112`). Stays as-is.

### 2.7 `rc_events` (EXISTING — unchanged)

From `schema.sql:235-242`. Service-role only, RLS enabled with no policies.
Webhook idempotency.

---

## 3. Edge Function Contracts

All Deno, deployed with `--no-verify-jwt` — each function verifies the JWT
itself via `userClient.auth.getUser()` (webhook excepted; shared secret).
CORS in v0.2 tightens from `*` to an allowlist (`wildex.app`, Vercel preview
domains, `exp://` dev). Echo matching `Origin` back.

### 3.1 `create-capture` (EXISTING — fixed)

```ts
POST /functions/v1/create-capture
Auth: Bearer <user JWT>   // required
Idempotency: not idempotent — each call mints a fresh captureId

Request:
{
  storage_path: string,          // must start with `${user.id}/`
  suggestion: {
    taxonId: number,             // positive int, < 1e9
    commonName: string,
    scientificName: string,
    iconicTaxon?: string,
    score: number,               // clamped [0,1] server-side
  },
  exif_datetime: string,         // "YYYY:MM:DD HH:MM:SS" or ISO 8601; required
  coords?: { lat: number, lng: number } | null
}

Response 200:
{
  capture: Capture               // canonical type, see §7
}

Response 4xx/5xx:
{ error: string, detail?: string }

Validation rules:
- EXIF freshness: |now - exif_datetime| <= 5 minutes (existing)
- storage_path prefix match: `${user.id}/` (existing)
- NEW v0.2: HEAD the object in Storage before INSERT — reject if file missing
- NEW v0.2: taxonId allowlist check (positive int < 1e9)
- NEW v0.2: write image_path as `${user.id}/${captureId}.jpg`; client uploads
  to a temp path → function moves to the canonical path (closes audit H-sec:
  storage path leaks user.id in filename)
```

### 3.2 `accept-challenge` (EXISTING — unchanged contract)

```ts
POST /functions/v1/accept-challenge
Auth: Bearer <user JWT>
Idempotency: keyed on (code) — second call returns 404 "already accepted"

Request:
{ code: string, opponent_capture_id: string }

Response 200:
{
  winner: 'a' | 'b',
  seed: string,
  log: BattleLogEntry[],
  challenge_id: string
}

Response 4xx/5xx:
{ error: string, detail?: string }

Validation:
- challenge exists, opponent_id IS NULL
- caller is NOT challenger (no self-battle)
- opponent_capture_id belongs to caller (user_id match)
- Loads both captures.stats from DB (never trusts client payload)
- Seed = `${challenger_capture}:${opponent_capture}:${Date.now()}`
- Writes resolution via service role (bypasses protect_challenge_resolution)
```

### 3.3 `revenuecat-webhook` (EXISTING — security fixes)

```ts
POST /functions/v1/revenuecat-webhook
Auth: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>  // shared secret
Idempotency: deduped by event_id in rc_events table

Request: RevenueCat event payload (see https://www.revenuecat.com/docs/webhooks)

Response 200:
{ ok: true, granted?: {item, qty}, duplicate?: event_id, skipped?: string }

Response 4xx/5xx: text

Validation:
- NEW v0.2: constant-time secret compare (crypto.subtle.timingSafeEqual)
- NEW v0.2: HMAC body signature verification (RC supports this)
- NEW v0.2: also flip is_pro / pro_until on profiles for wildex_pro_monthly
  events (current code only writes inventory)
```

### 3.4 `add-friend` (NEW v0.2)

```ts
POST /functions/v1/add-friend
Auth: Bearer <user JWT>
Idempotency: PK (user_id, friend_id) — duplicate request returns 200 with existing row

Request:
{ friend_code: string }           // 8-char, case-insensitive

Response 200:
{ friendship: { user_id, friend_id, status: 'pending', created_at } }

Response 4xx:
- 400 "missing friend_code"
- 404 "no user with that code"
- 409 "cannot friend yourself"
- 409 "already friends"

Validation:
- Look up profiles.friend_code → user_id under service role (clients cannot
  enumerate codes via direct SELECT)
- Insert friendships row (user_id=caller, friend_id=resolved, status='pending')
- If reverse-direction pending row exists → auto-accept (mutual add)
```

### 3.5 `accept-friend` (NEW v0.2)

```ts
POST /functions/v1/accept-friend
Auth: Bearer <user JWT>
Idempotency: re-accept returns the accepted row

Request:
{ requester_id: string }          // uuid of the user who sent the pending request

Response 200:
{ friendship: { user_id, friend_id, status: 'accepted', accepted_at } }

Validation:
- Caller must be the `friend_id` on a pending row from `requester_id`
- Updates that row to status='accepted', accepted_at=now()
- Atomically inserts the reverse row (caller → requester, status='accepted')
  so SELECT-by-either-side works
```

### 3.6 No other new edge functions

Local battle sim stays client-side. iNat ID stays client-side (v0.3 will add
server-side re-verify). Auth flows are Supabase-managed.

---

## 4. RLS Coverage Table

Every table × every operation. "Service role" = bypasses RLS, only callable
from Edge Fns with `SUPABASE_SERVICE_ROLE_KEY`.

| Table | S | I | U | D | Policy / mechanism (plain English) |
|---|---|---|---|---|---|
| `auth.users` | — | — | — | — | Supabase-managed. Not touched. |
| `profiles` | ✓ own | service-role + trigger | ✓ own (display_name only) | cascade only | Client reads own row; insert via `handle_new_user()` trigger on auth signup; updates restricted by column GRANT; deletes via auth cascade. |
| `captures` | ✓ own | **revoked from client** | none | ✓ own | Client reads/deletes own; INSERT only via `create-capture` Edge Fn (service role); UPDATE only via `feed_capture`/`age_up`/`allocate_point` SECURITY DEFINER RPCs. |
| `battles` | ✓ involved | service-role | service-role | service-role | Players read battles they were in; writes only via Edge Fns. |
| `challenges` | ✓ involved | ✓ self (with pre-resolution null check) | ✓ accept (gated by trigger) | ✓ own open | Players read challenges they're in; create their own with resolution columns nulled; accept gated by `protect_challenge_resolution` trigger; cancel only if unaccepted. |
| `friendships` | ✓ involved | service-role | service-role | ✓ own side | Read friendships you're in; modifications via `add-friend`/`accept-friend` Edge Fns; user can unilaterally delete their side. |
| `inventory` | ✓ own | **revoked** | **revoked** | **revoked** | Client reads own balances; writes only via RevenueCat webhook (service role). |
| `rc_events` | service-role | service-role | service-role | service-role | Idempotency table; no client access. |
| `storage.objects` (bucket `captures`) | ✓ own folder | ✓ own folder | ✓ own folder | ✓ own folder | Folder-namespaced by `auth.uid()::text`. **Depends on bucket privacy** — see §5. |

**Deliberately public:** none. v0.2 has no public dex, no public leaderboard.

---

## 5. Storage Buckets

### 5.1 `captures` bucket

**Visibility: PRIVATE (mandatory).** Promoted from manual dashboard step to
migration:

```sql
update storage.buckets set public = false where id = 'captures';
-- if it doesn't exist:
insert into storage.buckets (id, name, public) values ('captures','captures',false)
  on conflict (id) do update set public = excluded.public;
```

**Path convention (v0.2):** `${user.id}/${capture.id}.jpg`. Filename is the
server UUID, not `${user.id}-${Date.now()}` — closes the audit finding that
filenames leaked user UUIDs via signed URLs. Legacy objects keep old paths
(see Open Question #2). `image_path` column stores full path.

**Policies (from `schema.sql:254-273`, kept):**

| Op | Policy | Logic |
|---|---|---|
| SELECT | `captures select own folder` | `bucket_id='captures' AND (storage.foldername(name))[1] = auth.uid()::text` |
| INSERT | `captures insert own folder` | same check, `with check` |
| UPDATE | `captures update own folder` | same |
| DELETE | `captures delete own folder` | same |

**Display:** clients call `signCaptureUrl(image_path)` in `lib/storage.ts`
for a short-TTL signed URL. No public URLs.

---

## 6. Migration Plan: current → v0.2

Ordered. Each step is safe to apply with the app running unless **[ORDERED]**.

### Phase A — additive, no behavior change

1. **Create `profiles` table** (§2.1) and `handle_new_user()` trigger:
   ```sql
   create or replace function handle_new_user() returns trigger
     language plpgsql security definer set search_path = public as $$
   declare code text;
   begin
     loop
       code := generate_friend_code();
       begin
         insert into profiles (user_id, friend_code) values (new.id, code);
         exit;
       exception when unique_violation then continue; end;
     end loop;
     return new;
   end $$;
   create trigger on_auth_user_created
     after insert on auth.users
     for each row execute function handle_new_user();
   ```
2. **Backfill profiles** for existing users (idempotent on conflict).
3. **Create `friendships` table** (§2.5).
4. **Add `resolved_at` column to `challenges`.**
5. **Drop broken `challenges_players_idx`, create new indexes** (§2.4).
6. **Create `captures_user_age_idx`** (§2.2).
7. **Create `battles_player_a_idx` and `battles_player_b_idx`** (§2.3).
8. **Add constraints to captures**: `taxon_id` range check, `score` range
   check, `age` upper bound (≤ 10), `xp >= 0`. Use `NOT VALID` then
   `VALIDATE CONSTRAINT` to avoid full-table lock.

### Phase B — fix broken growth RPCs (audit blocker)

Currently `lib/growth.ts:58-85` calls `feed_capture(p_capture, p_xp, p_item)`,
`age_up(p_capture, p_use_tonic)`, `allocate_point(p_capture, p_stat, p_amount)`
— but schema signatures are `(p_capture_id text)` etc. Every call 500s.

**Decision: update schema-side to match the client call sites** (v0.2 needs
item-aware signatures for shop items anyway):

```sql
drop function if exists feed_capture(text);
create or replace function feed_capture(p_capture text, p_xp int, p_item text)
  returns captures language plpgsql security definer set search_path = public as $$
-- validate ownership; clamp p_xp ∈ [1,50]; reject unknown p_item
-- (allowed: null, 'growth_treat'); if 'growth_treat' decrement inventory;
-- update xp = xp + p_xp; return updated row.
$$;

drop function if exists age_up(text);
create or replace function age_up(p_capture text, p_use_tonic boolean)
  returns captures language plpgsql security definer set search_path = public as $$
-- if p_use_tonic, require inventory.age_tonic >= 1 and decrement;
-- enforce age < 10; cost = floor(60 * power(age, 1.3));
-- require xp >= cost; xp -= cost, age += 1, pending_points += 5.
$$;

drop function if exists allocate_point(text, text);
create or replace function allocate_point(p_capture text, p_stat text, p_amount int)
  returns captures language plpgsql security definer set search_path = public as $$
-- validate p_stat in ('hp','attack','defense','speed','special');
-- require pending_points >= p_amount; loop allocate (+2 stat, +1 allocated).
$$;
```
Grant `execute ... to authenticated`, revoke from `public`.

### Phase C — server-authoritative capture writes [ORDERED]

Must apply **after** `create-capture` Edge Fn v0.2 is redeployed (filename
uses captureId; HEAD object before INSERT; taxon validation).

9. Deploy `create-capture` v0.2.
10. Apply the **commented-out block from `schema.sql:277-279`** (audit H-sec-2):
    ```sql
    drop policy if exists "own captures insert" on captures;
    revoke insert on captures from authenticated;
    ```
11. Rename column:
    ```sql
    alter table captures rename column image_url to image_path;
    comment on column captures.image_path is
      'Supabase Storage path under "captures" bucket. Call signCaptureUrl() to display.';
    ```
    Update `lib/storage.ts`, `lib/types.ts`, all screens (mechanical pass).

### Phase D — bucket privacy [ORDERED]

12. Privatize bucket:
    ```sql
    update storage.buckets set public = false where id = 'captures';
    ```
    Storage RLS policies from `schema.sql:254-273` are already present.
13. Add CI assertion (separate task) that fails deploy if `public` flips true.

### Phase E — challenges tightening

14. Tighten INSERT policy (deny prefilling resolution columns):
    ```sql
    drop policy if exists "challenges insert self" on challenges;
    create policy "challenges insert self" on challenges
      for insert with check (
        auth.uid() = challenger_id and opponent_id is null
        and winner is null and seed is null and opponent_stats is null
      );
    ```
15. Add `challenges delete own open` policy. The existing `challenges accept`
    UPDATE policy stays — `protect_challenge_resolution` trigger gates which
    columns can change; `accept-challenge` Edge Fn bypasses both.

### Phase F — friends + auth

16. Deploy `add-friend` + `accept-friend` Edge Fns.
17. Confirm Apple + Google providers enabled in Supabase dashboard; verify
    redirect URLs for prod + Vercel preview domains. No schema change.

### Phase G — webhook hardening

18. Deploy `revenuecat-webhook` v0.2 with constant-time secret compare +
    HMAC body verification.
19. Extend SKU_GRANTS to flip `profiles.is_pro` / `pro_until` on
    `wildex_pro_monthly` events.

### Kept unchanged

`captures` columns (modulo image_url rename), `battles` table, `challenges`
table (one column added, indexes/policies changed), `inventory`, `rc_events`,
`protect_challenge_resolution` trigger, all existing SECURITY DEFINER fns
except the three growth RPCs.

**Deleted in v0.2:** `grant_purchase()` — dead code / footgun (audit M).

---

## 7. Single Canonical `Capture` Type

Lives at `lib/types.ts`. All screens import from here. **No screen defines
its own `Capture`** (audit found 5 divergent versions).

```ts
// lib/types.ts
import type { BattleStats } from './stats';

export type Stat = 'hp' | 'attack' | 'defense' | 'speed' | 'special';
export type Allocated = Partial<Record<Stat, number>>;

/**
 * Canonical Capture row shape. Mirrors the `captures` table after v0.2.
 * Generated DB types (Supabase CLI) should be the long-term source of truth;
 * this hand-rolled type is the v0.2 bridge.
 */
export type Capture = {
  id: string;                       // server UUIDv4
  user_id: string;                  // auth.users.id (uuid)
  taxon_id: number;                 // bigint, positive
  common_name: string;
  scientific_name: string;
  score: number;                    // [0, 1]
  stats: BattleStats;               // see lib/stats.ts
  xp: number;                       // >= 0
  age: number;                      // [1, 10]
  pending_points: number;           // >= 0
  allocated: Allocated;             // {} default
  lat: number | null;
  lng: number | null;
  image_path: string | null;        // Supabase Storage path; sign before display
  created_at: string;               // ISO 8601
};

export type CaptureSelect = keyof Capture;
```

Every `supabase.from('captures').select(...)` uses `'*'` or includes all keys
of `Capture` (else use a `Pick<>` subtype). The `useCaptures` hook
(AUDIT-ARCHITECTURE recommendation) wraps this and is the **mandatory** data
access path for screens in v0.2.

---

## 8. Indexes — Final List with Rationale

| Table | Index | Rationale |
|---|---|---|
| `captures` | `(user_id, created_at desc)` | Dex list ordered newest-first — existing, kept. |
| `captures` | `(taxon_id)` | Taxon lookup for future "who else has this species" — existing, kept. |
| `captures` | `(user_id, age desc)` | Grow screen sorts by oldest/most-leveled first — **NEW v0.2**. |
| `battles` | `(player_a, created_at desc)` | Battle history for player A — **NEW v0.2**, replaces single composite that didn't serve OR queries. |
| `battles` | `(player_b, created_at desc)` | Battle history for player B — **NEW v0.2**. |
| `challenges` | `(code)` | Server lookup by friend code — existing. |
| `challenges` | `(challenger_id, created_at desc)` | My-outgoing-challenges list — **NEW v0.2**, replaces broken `(challenger_id, opponent_id)`. |
| `challenges` | `(opponent_id, created_at desc) where opponent_id is not null` | My-incoming-challenges list — **NEW v0.2**. |
| `challenges` | `(created_at desc) where opponent_id is null` | Server-side pending sweep (cleanup of abandoned codes) — **NEW v0.2**. |
| `profiles` | `(friend_code)` | UNIQUE, used by `add-friend` for code → uuid lookup. |
| `friendships` | `(friend_id, status)` | "Who has friended me / pending" — common screen query. |
| `inventory` | PK `(user_id, item)` | Existing — sufficient. |
| `rc_events` | PK `(event_id)` | Existing — dedup. |

**Audit fix:** existing `challenges_players_idx` on
`(challenger_id, opponent_id)` does not serve `.or(challenger_id.eq,
opponent_id.eq)` at `lib/multiplayer.ts:89` — Postgres uses the leading
column only. Replaced with two single-column indexes.

---

## 9. Open Data Questions (Need Human Input)

1. **Friend codes — rotatable or permanent?** Spec makes them permanent
   (one per user on `profiles`). Public sharing → forever spam-able.
   Options: (a) permanent + future block list, (b) user-rotatable with
   rate limit, (c) drop `profiles.friend_code` entirely and rely only on
   per-challenge `challenges.code`. **Decision needed before Phase A.**

2. **Legacy capture image paths.** Existing rows have
   `image_url = ${user.id}/${user.id}-${Date.now()}.jpg`. (a) leave them
   alone (rename is metadata-only) and accept legacy UUID leak, or
   (b) one-shot batch-rename to `${user.id}/${captureId}.jpg`. Affects
   Phase C step 11.

3. **`is_pro` source of truth.** RevenueCat is authoritative; `profiles.is_pro`
   is a cache. (a) webhook-only (drift on missed events), (b) webhook +
   nightly RC REST reconciliation, (c) live RC lookup on every Pro-gated
   action (latency). RC docs recommend (b).

4. **Online battles in `battles` table?** Today `accept-challenge` writes
   only to `challenges`. Should resolved challenges also INSERT a `battles`
   row so all 1v1 history lives there? Or is `battles` reserved for a
   future ranked mode? Affects `useBattleHistory` hook design.

5. **Capture deletion with active references.** `captures delete own` lets
   players delete captures used in open challenges or recorded battles —
   FK has no cascade so it errors opaquely. (a) cascade and lose history,
   (b) soft-delete via `deleted_at`, (c) `before delete` trigger blocks
   with a clear message. **Recommend (c);** needs sign-off.

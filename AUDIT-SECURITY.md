# Wildex Security Audit
_Generated: 2026-05-20_

> Scope: read-only review of the Wildex repo at `/Users/nickonvorobiev/Downloads/wildex`.
> Stack note: README calls Wildex an Expo (React Native) + Supabase app, not Next.js.
> The hand-off prompt's "Next.js" framing is incorrect; this audit treats the
> Expo client, the Expo web build (deployed via `vercel.json` as a static SPA),
> and the three Supabase Edge Functions (Deno) as the surface.

## Executive Summary

The team has clearly absorbed a previous round of audit feedback — RLS is on every
user-data table, growth/IAP/battle resolution have been pushed into
`SECURITY DEFINER` functions or Edge Functions, the friend-code SELECT was
narrowed, and Storage RLS scaffolding is written. **However, several of the
"fixed" controls are not actually applied in production:** the
`revoke insert on captures` block at the bottom of `schema.sql` is still
commented out, the growth RPC client wrappers call signatures that do not match
the schema (so every feed/age-up/allocate call currently 500s), and the
Storage bucket privatization is a manual dashboard step with no enforcement in
code. The most realistic high-severity exploit today is **a signed-in user
INSERT-ing captures directly into the `captures` table with arbitrary
`stats` / `xp` / `age` / `pending_points` / `allocated` values**, completely
sidestepping the `create-capture` Edge Function and its tier-1 anti-cheat. The
other live risks are RevenueCat webhook secret comparison with non-constant-time
equality and the photo bucket potentially still being public.

Overall posture: **medium**. Architecture is correct; rollout is incomplete.

## Findings by Severity

### 🔴 Critical (immediate fix)

- **Client-side INSERT on `captures` lets users self-grant stats, xp, age, and pending points**
  — `supabase/schema.sql:26-27` (`"own captures insert"` policy still active) and
  `supabase/schema.sql:231-232,277-279` (the `revoke insert` block is intentionally
  commented out per the deploy note).
  The `create-capture` Edge Function (`supabase/functions/create-capture/index.ts`)
  is supposed to be the *only* path that writes a row to `captures`, with EXIF
  freshness as tier-1 anti-cheat and server-rolled stats. But because the
  `authenticated` role still has `INSERT` privilege on `captures` and the RLS
  policy only checks `auth.uid() = user_id`, an attacker with a valid Supabase
  session can call:
  ```js
  supabase.from('captures').insert({
    id: 'attacker-1', user_id: <their uid>, taxon_id: 1,
    common_name: 'x', scientific_name: 'x', score: 1,
    stats: { hp:9999, attack:9999, defense:9999, speed:9999, special:9999,
             element:'beast', rarity:'legendary' },
    xp: 999999, age: 10, pending_points: 100, allocated: {}
  })
  ```
  Bypasses EXIF check, server stat roll (`rollStats`), and any future tiered
  anti-cheat. Combined with the `accept-challenge` flow (which reads
  `captures.stats` from the DB as "authoritative"), this guarantees the
  attacker wins every async multiplayer battle.
  **Fix:** apply the commented block in `schema.sql:277-279` (drop the
  `"own captures insert"` policy AND `revoke insert on captures from
  authenticated`) immediately after verifying `create-capture` works in prod.
  Until then the security model documented in the comments is fiction.

- **Photo storage bucket privacy depends on an un-enforced manual dashboard step**
  — `supabase/schema.sql:76-78,244-273`, `README.md:22`,
  `supabase/functions/README.md:60-61`.
  The schema includes Storage RLS policies that gate by
  `(storage.foldername(name))[1] = auth.uid()::text`, but the comment is explicit:
  "Bucket MUST be private — public-bucket reads bypass these policies entirely."
  Privatization is a clickable step in the Supabase dashboard with no migration
  asserting the current state. If the bucket is still public (the
  original/legacy state mentioned in schema lines 76-78 and the older "create
  a public bucket" comment), every capture photo is enumerable by anyone with
  the storage path, and `signCaptureUrl()` in `lib/storage.ts:48` is
  cosmetic — the underlying object is already world-readable.
  **Fix:** treat bucket privacy as a deploy artifact: have a CI/CD or
  `supabase` CLI step that runs
  `update storage.buckets set public = false where id = 'captures'` (or assert
  it). Add a startup probe in CI that flags the bucket if it is public.
  **Exploit:** guess a user UUID (visible in challenge rows once Code-1 below
  is also exploited, or via any leaked log), iterate likely captureIds, GET
  the public bucket URL — full photo exfil.

### 🟠 High

- **RevenueCat webhook uses non-constant-time string comparison for the shared secret**
  — `supabase/functions/revenuecat-webhook/index.ts:45`.
  ```ts
  if (auth !== `Bearer ${WH_SECRET}`) return new Response("forbidden", { status: 403 });
  ```
  String `!==` returns early on the first byte mismatch. An attacker can
  byte-by-byte time the comparison (Edge Function cold/warm latency is noisy
  but not infinite) to recover the secret. With the secret recovered they can
  forge arbitrary inventory grants for any `app_user_id`.
  **Fix:** constant-time compare. In Deno:
  ```ts
  const a = new TextEncoder().encode(auth);
  const b = new TextEncoder().encode(`Bearer ${WH_SECRET}`);
  if (a.length !== b.length || !crypto.subtle.timingSafeEqual?.(a, b)) ...
  ```
  Or use `crypto.subtle.timingSafeEqual` via a polyfill / manual XOR loop.

- **RevenueCat webhook is JWT-disabled and authenticates only the shared secret — no payload signature check**
  — `supabase/functions/revenuecat-webhook/index.ts` (deployed with
  `--no-verify-jwt` per `supabase/functions/README.md:21-22`).
  RevenueCat supports webhook payload signing/verification beyond the
  Authorization header. Right now the function trusts whatever JSON it
  receives as long as one shared secret matches. If the secret is logged,
  rotated incorrectly, or leaks via the timing channel above, anyone can grant
  themselves `pro_month`, lures, or age tonics by POSTing a synthetic event
  with `app_user_id = <victim>`. There is no IP allowlist either.
  **Fix:** verify RC's webhook signature (HMAC of body) in addition to the
  Bearer secret, and rotate the secret on a schedule. Pin RC's source IPs in
  Edge Function routing if/when they publish them.

- **Captures storage path leaks the user's Supabase UUID into the object key**
  — `app/capture.tsx:75`, `lib/storage.ts:18`.
  ```ts
  const storagePath = await uploadCaptureImage(photo.uri, `${user.id}-${Date.now()}`);
  // → `${user.id}/${user.id}-${Date.now()}.jpg`
  ```
  The folder structure is intentionally namespaced by `user.id` (needed for
  Storage RLS by folder), but the *filename* also embeds `user.id`. Any
  signed URL Wildex hands to a client (e.g. via `signCaptureUrl`) reveals the
  owner's UUID in the path, which is then trivially extractable from `<img
  src>` in DevTools or HTTP logs. UUIDs are not secrets per se, but the
  product specifically generates an opaque server-side `captureId` via
  `crypto.randomUUID()` in `create-capture/index.ts:86` "to not leak user.id"
  (their words, comment "audit M5"). The fix was only half-applied.
  **Fix:** use the server-issued `captureId` (or another opaque slug) as the
  filename: `${user.id}/${captureId}.jpg`. Coordinate ordering: client uploads
  to a temp path → calls `create-capture` → server moves/renames or accepts
  the temp path and writes its UUID alongside.
  **Side effect:** the `image_url` column currently stores
  `userId/userId-timestamp.jpg`, so even existing private signed URLs leak.

- **`captures.image_url` is also the storage path, written by the server but never sanity-checked against `user.id` after upload**
  — `supabase/functions/create-capture/index.ts:73,100`.
  The function does verify `body.storage_path.startsWith(\`${user.id}/\`)`, but
  it does NOT call `admin.storage.from('captures').download(storage_path)` to
  confirm a file actually exists. A user could POST a `storage_path` like
  `<their uuid>/anything` without uploading anything, get a capture row, and
  then upload nothing — wasted DB row, but more importantly the row contains
  the *advertised* (client-provided) `taxon_id` + `score`, which feeds rarity
  and stat budget. Combined with no anti-cheat tiers 2-5 (admitted in the
  README), a user can claim "iconicTaxon: Mammalia" + "score: 0.99" for
  literally any photo or no photo. EXIF freshness only proves *some* photo
  was taken recently in the user's camera roll.
  **Fix:** require the file to exist before the INSERT (HEAD via service role
  on `storage.objects`), and run a server-side iNat re-verification at least
  for high-rarity rolls before persisting.

- **Captures table allows the client to set every column, including `xp`, `age`, `pending_points`, `allocated`, `stats` at INSERT time**
  — `supabase/schema.sql:90-95` (columns added) + the still-active
  `"own captures insert"` policy (line 26-27).
  Even after Critical 1 above is closed by revoking INSERT, note that
  `feed_capture`, `age_up`, `allocate_point` are the ONLY legitimate writers
  to `xp/age/pending_points/allocated`. Right now `app/grow.tsx` calls them
  via `supabase.rpc(...)` with arguments named `p_capture`, `p_xp`,
  `p_item`, `p_use_tonic`, `p_amount` (see `lib/growth.ts:59-85`) — but the
  schema's RPC signatures are `feed_capture(p_capture_id text)`,
  `age_up(p_capture_id text)`, `allocate_point(p_capture_id text, p_stat
  text)`. **The growth RPC client code does not match the schema** and every
  feed/age-up/allocate call will fail at runtime with "function not found" or
  "wrong arg names." That is a functional bug, but the security consequence
  is that a user motivated to "make progression work" might fall back to
  direct table UPDATE — and there is no UPDATE policy on `captures` at all
  (only SELECT/INSERT/DELETE). So UPDATE will fail (good). However if anyone
  adds a permissive UPDATE policy as a fix, the growth columns must be locked
  down with column-level GRANTs or a BEFORE UPDATE trigger.
  **Fix:** correct the RPC arg names in `lib/growth.ts` (or vice versa in
  `schema.sql`), and add a comment in the schema that no UPDATE policy is
  intentional. Consider a `protect_capture_growth_columns` trigger mirroring
  `protect_challenge_resolution`.

### 🟡 Medium

- **`grant_purchase()` SECURITY DEFINER function is dead code that would crash if invoked correctly**
  — `supabase/schema.sql:182-197`.
  It checks `auth.role() <> 'service_role'`, then inserts
  `values (auth.uid(), p_item, p_qty)`. Under `service_role`, `auth.uid()` is
  NULL, and `inventory.user_id` is `NOT NULL`. The RevenueCat webhook
  bypasses this function entirely and writes `inventory` directly with
  service-role credentials, so the bug is never hit — but it's a footgun: a
  future maintainer who tries to call `grant_purchase` from another server
  context will get a NOT NULL violation and think the schema is broken. Worse,
  if someone "fixes" it by removing the `service_role` check or adding
  `grant execute ... to authenticated`, the function reverts to the original
  C-sec-5 critical (client-claimed inventory).
  **Fix:** either delete `grant_purchase` entirely, or take an explicit
  `p_user_id uuid` parameter and validate it server-side.

- **All Edge Functions allow `Access-Control-Allow-Origin: *`**
  — `supabase/functions/accept-challenge/index.ts:21-22`,
  `supabase/functions/create-capture/index.ts:24-25`.
  CORS `*` with `Authorization` header is unusual but allowed; browsers will
  preflight and the user-Bearer-token model means no cookies. The practical
  risk is that any third-party site can invoke these functions on behalf of a
  user who happens to have a valid Wildex session (e.g. a malicious cross-tab
  attack where the attacker has the user's JWT in `localStorage` — which is
  the model for SPA tokens). Risk lowered because the functions only allow
  the user to act on their own data (capture under their UUID, accept a
  challenge they don't own).
  **Fix:** allowlist your Vercel preview + prod domains in
  `Access-Control-Allow-Origin` rather than `*`. Echo back the request
  `Origin` if it matches the allowlist.

- **Magic-link send rate limit is client-side only**
  — `app/sign-in.tsx:31,52`.
  ```ts
  setCooldown(30);  // client-side rate limit; Supabase Auth enforces its own per-IP cap.
  ```
  An attacker scripting against the Supabase Auth endpoint directly skips the
  cooldown entirely; only Supabase's per-IP rate limit applies, which is
  weak against rotating proxies. This enables email-bomb against a victim
  email (Supabase will gladly send N magic links if N comes in slowly enough
  to dodge IP throttle) and modest cost amplification.
  **Fix:** add a per-email rate limit via a Supabase Edge Function or
  Auth Hook (PostgreSQL function on `auth.send_email`). Supabase has a
  built-in template hook for this in 2024+.

- **`identifyAnimal()` trusts the iNaturalist response shape and propagates `taxon.id` directly into the DB as `bigint`**
  — `lib/inaturalist.ts:17-46`, `supabase/functions/create-capture/index.ts:66-69`.
  The Edge Function only checks `typeof taxonId === "number"` — it accepts
  `Number.MAX_SAFE_INTEGER`, negatives, fractional values, etc. The DB
  column is `bigint` so very large/negative values won't cause a crash, but
  there's no allowlist of "real" iNat taxa, so a man-in-the-middle of the iNat
  API response (rare; HTTPS) or a future change in the iNat API contract
  could insert nonsense `taxon_id` rows. `iconicTaxon` is similarly accepted
  as any string and only mapped to "unknown" if not in `ELEMENT_MAP`.
  **Fix:** validate `taxonId` is a positive integer below ~10^9, and either
  reject unknown `iconicTaxon` strings or normalize them server-side.

- **ErrorBoundary surfaces full stack traces to the user (web only)**
  — `app/_layout.tsx:23-26`.
  Renders `String(this.state.error?.stack ?? '')` to the screen. On the web
  build (Expo for web → Vercel SPA, output `dist/`) the stack will contain
  bundle file names + line numbers, which leaks code structure to anyone who
  triggers a crash. Source maps are typically not deployed, so the leak is
  limited, but bundle paths can still hint at internal lib names. Low impact
  on native (already debuggable by the user).
  **Fix:** render stack only when `__DEV__` or a debug flag is set; in prod
  show a generic error.

- **`lib/multiplayer.ts:89` interpolates `user.id` into a PostgREST `.or()` filter string**
  ```ts
  .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
  ```
  `user.id` is a UUID returned by `supabase.auth.getUser()` (server-fetched
  from the JWT), so a user can't inject anything but their own UUID — but
  the pattern is fragile. If someone refactors this to take a parameter or
  read from localStorage, it becomes an injection vector for PostgREST
  filter operators.
  **Fix:** use the typed query builder:
  `.or('challenger_id.eq.<uuid>,opponent_id.eq.<uuid>')` via two `.eq()`
  calls or use the new `.in()` form. At minimum, assert the value matches
  `/^[0-9a-f-]{36}$/`.

### 🟢 Low / Informational

- **Apple ID Token nonce flow is correct** — `lib/auth.ts:29-46`. SHA-256
  hashed nonce to Apple, raw to Supabase — matches Apple's documented replay
  defense (audit M1). Good.

- **Google OAuth on native uses `expo-web-browser` + manual code exchange** —
  `lib/auth.ts:55-79`. Correct pattern; `redirectTo: NATIVE_REDIRECT`
  matches `app.json` scheme. Good. The web branch falls back to
  `window.location.origin` if `EXPO_PUBLIC_REDIRECT_URL_WEB` is unset
  (`lib/auth.ts:9-15`), which is fine *as long as Supabase's URL allowlist
  is set correctly*. README mentions this; consider failing closed in code
  rather than relying on dashboard config.

- **Magic-link `emailRedirectTo` on web also depends on `EXPO_PUBLIC_REDIRECT_URL_WEB`** —
  `lib/auth.ts:84`. Same caveat as Google.

- **`captures` has no UPDATE policy** which means UPDATE is implicitly denied
  for clients. That's the intended state — flag with an inline comment so a
  future maintainer doesn't "fix" it accidentally.

- **`battles` table has no INSERT policy** — only SELECT for involved players.
  In practice no client code path INSERTs into `battles` (the schema doesn't
  show any), but worth keeping the table defined so future analytics queries
  don't need to be re-RLS'd.

- **`challenges` UPDATE policy ("challenges accept") lets opponent UPDATE any
  column** — `supabase/schema.sql:72-74`. Mitigated by
  `protect_challenge_resolution` trigger which blocks the dangerous columns
  for non-service-role writers, but a defense-in-depth fix is to tighten the
  UPDATE policy to only allow setting `opponent_id` + `opponent_capture` (the
  schema even notes this option, line 293-296).

- **Friend codes 32^8 ≈ 1.1×10^12** — collision-resistant per
  `lib/multiplayer.ts:22-34`. Good (audit M3 closed).

- **Captures `id` column is `text primary key`** while `create-capture` uses
  `crypto.randomUUID()` server-side (good). Old `app/capture.tsx` patterns
  predicting `id = '${user.id}-${Date.now()}'` are now dead — but the local
  file used for the storage path still uses that string (see High,
  storage-path-leak finding above). Aligning these would be cleaner.

- **`ruvector.db` is gitignored** (`.gitignore:14`). Good — sidecar local DB
  shouldn't ship in repo.

- **`.env.local` is gitignored** (`.gitignore:5`) and contains the
  publishable (anon) Supabase key, which is meant to be public-bundled — not
  a leak. Good.

- **No `dangerouslySetInnerHTML` / `eval` / `new Function` anywhere in the
  app or lib trees.** Good — search returned zero hits.

- **No raw SQL string construction** — all DB access goes through
  `@supabase/supabase-js` PostgREST query builder + named RPCs. Good — SQL
  injection surface is zero, modulo the `.or()` interpolation noted above.

## Attack Surface Map

**Entry points (authenticated unless noted):**

- `POST /functions/v1/accept-challenge` — Bearer JWT, body `{ code,
  opponent_capture_id }`. Looks up challenge by code under service role,
  loads both captures' stats from DB, simulates server-side, writes via
  service role bypassing the protect_challenge_resolution trigger.
- `POST /functions/v1/create-capture` — Bearer JWT, body `{ storage_path,
  suggestion, exif_datetime, coords }`. Validates EXIF freshness (5 min
  window), validates path is under `${user.id}/`, server-rolls stats,
  inserts.
- `POST /functions/v1/revenuecat-webhook` — **public**, no JWT (`--no-verify-jwt`),
  authenticated only by `Authorization: Bearer <WH_SECRET>` shared secret.
- Direct Supabase REST/PostgREST under user JWT:
  - `SELECT/INSERT/DELETE captures` — per-user RLS
  - `SELECT/INSERT/UPDATE challenges` — per-user RLS + protect trigger
  - `SELECT battles` — SELECT only for involved
  - `SELECT inventory` — per-user RLS; writes revoked
  - `RPC feed_capture / age_up / allocate_point` — SECURITY DEFINER, checks
    `auth.uid() = user_id` inside the function
- Supabase Storage `captures` bucket — RLS by folder name under
  `auth.uid()::text`, IF the bucket is private.
- Supabase Auth — magic link, Apple OAuth, Google OAuth.

**Data flows:**

1. Camera → `identifyAnimal()` (iNat) → suggestion shown to user.
2. Photo upload to `captures/${user.id}/${user.id}-${Date.now()}.jpg` →
   `create-capture` Edge Fn → row in `captures`.
3. Open challenge → client INSERT to `challenges` with own stats →
   share code OOB → opponent calls `accept-challenge` → server resolves.
4. RevenueCat purchase → SDK → Apple → RC webhook → `inventory` upsert.
5. Growth RPCs (currently broken arg names) → SECURITY DEFINER → mutate
   `captures.xp/age/pending_points/stats/allocated`.

## RLS Coverage

| Table | RLS enabled | Policies | Notes |
|---|---|---|---|
| `captures` | Y | own SELECT, own INSERT, own DELETE; no UPDATE policy | **Critical:** INSERT policy lets clients set any column including stats/xp/age. Revoke INSERT after `create-capture` is live (see Critical-1). UPDATE is implicitly denied. |
| `battles` | Y | SELECT for involved players (a or b); no INSERT/UPDATE/DELETE policy | Inserts only via service role. |
| `challenges` | Y | "own challenges only" SELECT (tightened from old "involved or open"), INSERT by challenger, UPDATE by opponent (gated by `protect_challenge_resolution` trigger) | UPDATE policy is broad; trigger restricts dangerous columns. Defense-in-depth: tighten UPDATE policy to specific columns. |
| `inventory` | Y | SELECT self; INSERT/UPDATE/DELETE explicitly revoked from `authenticated` | Writes go through RevenueCat webhook (service role) or `grant_purchase` (currently broken dead code). |
| `rc_events` | Y | no policies (service-role only) | Correct — idempotency table. |
| `storage.objects` (bucket `captures`) | Storage RLS policies present in schema | folder-namespaced SELECT/INSERT/UPDATE/DELETE | **Critical:** depends on bucket being private; bucket privatization is a manual dashboard step. |
| `auth.users` | Supabase-managed | n/a | n/a |

## What's Done Well

- **Auth flows are textbook.** Apple Sign-In with hashed/raw nonce pair,
  Google OAuth code-exchange on native, explicit redirect URLs (not derived
  from `window.location`). Closes prior audit M1 / H-sec-5.
- **Battle resolution is server-authoritative.** `accept-challenge` reads
  both stat blocks from the DB (never trusts client payload), simulates
  with a server-chosen seed, and writes the resolution under service role
  through a trigger that blocks any other path.
- **Inventory writes are tightly controlled.** Direct INSERT/UPDATE/DELETE
  revoked from `authenticated`, RevenueCat webhook is the only legitimate
  granter, idempotency table prevents double-credit on retries, SKU →
  inventory mapping is server-side so clients can't inject unknown items.
- **Deterministic engines (rng/stats/battle) have a single source of truth
  in `lib/rng.ts` + the inlined Deno copies**, with comments enforcing
  byte-equivalence — replay-ability for cheat detection works.

## Recommended Next Steps

1. **Today (Critical):** apply the commented `revoke insert on captures
   from authenticated; drop policy "own captures insert"` block. Verify
   `create-capture` is live end-to-end first; then flip the switch in the
   same maintenance window. This single change collapses the largest live
   attack surface in the app.
2. **Today (Critical):** verify the `captures` Storage bucket is **private**
   in the Supabase dashboard, and add a CI assertion / migration that fails
   loudly if it's set back to public. Apply the Storage RLS policies if not
   already.
3. **This week (High):**
   - Switch the RevenueCat webhook secret check to a constant-time compare
     and add HMAC signature verification of the body.
   - Fix the `storage_path` to use the server-issued `captureId` so user
     UUIDs stop appearing in the filename.
   - Add an existence-check on the uploaded object before the `captures`
     insert in `create-capture`.
   - Fix the RPC argument names in `lib/growth.ts` to match
     `feed_capture(text)`, `age_up(text)`, `allocate_point(text, text)` —
     the growth loop is currently broken.
4. **Soon (Medium):**
   - Replace `Access-Control-Allow-Origin: *` on Edge Functions with an
     allowlist of `wildex.app` / Vercel domains.
   - Add server-side magic-link rate limiting via a Supabase Auth Hook.
   - Lock down or delete `grant_purchase` (current implementation is dead +
     foot-gun).
   - Validate `taxon_id` and `iconicTaxon` against expected ranges/values in
     `create-capture`.
   - Tighten the `challenges` UPDATE policy to specific columns (the
     trigger covers it but defense-in-depth).
5. **Before App Store launch:**
   - Implement anti-cheat tiers 2-5 (GPS-vs-iNat-range, liveness, server-side
     iNat re-verify, per-user trust score) — README is honest these are
     unimplemented. Tier-1 EXIF alone is bypassable in <30 seconds with a
     re-saved photo.
   - Gate the ErrorBoundary stack output behind `__DEV__`.
   - Decide whether `captures.image_url` should be the storage path
     (current) or stripped from the schema entirely — there's no reason for
     the client to ever read the raw path; signed URLs are minted on demand.

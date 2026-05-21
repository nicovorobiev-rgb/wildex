# Wildex v0.2 Security Audit — Round 2
_Generated: 2026-05-21_

> Scope: read-only review of the v0.2 rebuild at `/Users/nickonvorobiev/Downloads/wildex`.
> Surface: 4 SQL migrations (0001–0004), 5 Supabase Edge Functions
> (`create-capture`, `accept-challenge`, `add-friend`, `accept-friend`,
> `revenuecat-webhook`), the auth wrapper (`lib/auth.ts`, `lib/AuthContext.tsx`),
> and the three v0.2 service modules (`services/captures.ts`, `battles.ts`,
> `friends.ts`). Comparison baseline: `AUDIT-SECURITY.md` (v0.1, 2026-05-20).

## Executive Summary

The v0.2 rebuild closes the two critical findings from v0.1 (`captures` INSERT
revoked at the DB level, captures bucket now privatized with a loud migration
assertion) and addresses the bulk of the high/medium findings: constant-time
secret compare on the RevenueCat webhook, opaque server-issued capture IDs in
the storage path, a HEAD existence check before INSERT, taxon ID range
validation, an env-var CORS allowlist on four of five functions, and corrected
growth-RPC signatures. The architecture is genuinely tighter; most v0.1
findings can be marked closed.

Remaining concerns cluster in three areas: (1) the `accept-friend` Edge
Function still calls `accept_friendship` with the wrong argument names so it
silently falls through to a non-atomic two-write fallback (race window between
UPDATE and the reverse INSERT); (2) the mutual-add path in `add-friend` has
the same non-atomic vulnerability the migration `accept_friendship` RPC was
meant to close, but `add-friend` does not call that RPC; (3) the
RevenueCat-webhook fallback path is non-additive on repeat purchases, and the
overall webhook still has no IP allowlist or HMAC body signature. Two new
medium findings surface in v0.2: `add-friend` ships a permissive
`Access-Control-Allow-Origin: *` default that bypasses the env allowlist, and
`accept-friend` hardcodes its origin allowlist (no env override) which will
trip Vercel preview deploys outside the hardcoded `*.vercel.app` regex.

Overall posture: **medium-high**. Critical risks are closed; most remaining
issues are race-windows, fallback paths that degrade silently, and CORS
inconsistency across functions.

## Status of v0.1 Findings

| ID | Finding | Status | Notes |
|----|---------|--------|-------|
| Crit-1 | Client INSERT on `captures` lets users self-grant stats/xp/age/pending_points | **Closed** | `0003_lockdown.sql:44-45` drops `"own captures insert"` policy and revokes INSERT from `authenticated`. `create-capture` Edge Fn is now the only writer. |
| Crit-2 | Photo bucket privacy is an un-enforced manual dashboard step | **Closed** | `0003_lockdown.sql:55-70` does `update storage.buckets set public = false` AND raises an exception if the bucket is still public after the update — fails the migration loudly. Storage RLS policies remain unchanged in `schema.sql:244-272`. |
| H-sec-1 | RevenueCat webhook non-constant-time `!==` compare | **Closed** | `revenuecat-webhook/index.ts:117-132` `timingSafeEqual` — full-length XOR loop, no early return, `0 ?? 0` pads out-of-bounds bytes to keep loop iterations constant. Correct implementation. |
| H-sec-2 | RC webhook is JWT-disabled and only authenticates shared secret (no HMAC) | **Still open (acceptable)** | Function comment (`index.ts:7-18`) documents that RevenueCat does not currently publish an HMAC signing scheme; defence-in-depth is constant-time compare + schema validation + idempotency table. Acceptable given RC's product limitations, but secret rotation + IP allowlist remain valuable. |
| H-sec-3 | Capture storage path leaks user UUID in filename | **Closed** | `create-capture/index.ts:229,235` generates an opaque `crypto.randomUUID()` server-side; `canonicalImagePath = ${user.id}/${captureId}.jpg`. Column renamed `image_url → image_path` in `0003_lockdown.sql:289-303`. **Note:** the *client* still uploads to a temp path that may embed `user.id`; the canonical path is recorded but the client must rename/move — see Open Finding M-1. |
| H-sec-4 | `captures.image_url` written without verifying file exists in storage | **Closed** | `create-capture/index.ts:245-254` calls `admin.storage.from("captures").list(folder, { search: filename, limit: 1 })` and rejects if no match. Server-side iNat re-verification still TBD (out of audit scope; acknowledged in README). |
| H-sec-5 | Client can set every column on `captures` INSERT including growth fields | **Closed** | Same fix as Crit-1 — INSERT revoked. `create-capture` Edge Fn sets `xp=0, age=1, pending_points=0, allocated={}` server-side. UPDATE policy on `captures` still absent (good — implicit deny). |
| M `grant_purchase` dead-code footgun | `grant_purchase` SECURITY DEFINER fn would crash if called | **Closed** | `0003_lockdown.sql:400` `drop function if exists public.grant_purchase(text, int, text);` — gone. |
| M CORS `*` on edge functions | All edge functions allow `*` | **Partially closed** | Closed on `create-capture` + `accept-challenge` (env allowlist, deny by default). **NOT** closed on `add-friend` (`index.ts:23,63-70` defaults to `"*"` when `WILDEX_ALLOWED_ORIGINS` is unset, and the wildcard branch echoes the request origin). **NOT** closed on `accept-friend` (`index.ts:32-45` hardcodes the allowlist; no env override). See New Finding M-2. |
| M magic-link rate limit client-side only | `app/sign-in.tsx` cooldown is client-only | **Still open** | No server-side Auth Hook added in v0.2; `lib/auth.ts:43-50` still calls `signInWithOtp` directly. |
| M `identifyAnimal` trusts iNat shape; `taxon.id` propagated unchecked | Edge Fn took any number for taxon_id | **Closed** | `create-capture/index.ts:107-110` `isValidTaxonId` requires positive integer < 1e9. `0003_lockdown.sql:317-327` adds a CHECK constraint enforcing the same. `iconicTaxon` still loosely typed (`as string`) — minor, see L-3 below. |
| M ErrorBoundary surfaces stack traces on web | Stack leaks on crash | **Out of audit scope** | `app/_layout.tsx` not in this review's read list; no v0.2 change visible in the files reviewed. Treat as still open until verified. |
| M `lib/multiplayer.ts` interpolates `user.id` into `.or()` filter | Fragile PostgREST filter | **Still open / same pattern in services/battles.ts:239** | `services/battles.ts:239` uses `.or('player_a.eq.${user.id},player_b.eq.${user.id}')` — same fragile pattern, same low risk (uid is JWT-derived). Pattern moved, not fixed. |
| M challenges UPDATE policy too broad | Mitigated by trigger | **Partially closed** | `0003_lockdown.sql:374-382` tightens the INSERT policy WITH CHECK to reject pre-filled resolution columns. UPDATE policy `"challenges accept"` from `schema.sql:72-74` is **not** narrowed in any migration — still relies on the `protect_challenge_resolution` trigger. Trigger plus tightened INSERT = acceptable; defense-in-depth on UPDATE remains a nice-to-have. |
| L Apple ID Token nonce flow correct | — | **Still correct** | `lib/auth.ts:73-78` SHA-256 hashed nonce to Apple, raw nonce to Supabase. |
| L Google OAuth + magic-link `emailRedirectTo` depend on env var | — | **Still open** | `lib/auth.ts:27-32` `webRedirect()` falls back to `window.location.origin` if `EXPO_PUBLIC_REDIRECT_URL_WEB` is unset — same code as v0.1. Low risk, gated by Supabase URL allowlist. |
| L `captures` has no UPDATE policy | Intended | **Still intended (good)** | No UPDATE policy added in any migration. Growth columns are written through SECURITY DEFINER RPCs only. |
| L `battles` has no INSERT policy | Intended | **Still intended (good)** | No INSERT policy in any migration. Written only via service role (currently no path actually inserts into `battles` in v0.2 code reviewed; `accept-challenge` writes to `challenges` only). |
| L Friend code 32^8 collision-resistant | — | **Still correct** | Implementation moved to `generate_friend_code()` in `0001_profiles.sql:62-81`. Loop on `unique_violation` in `handle_new_user`. |

## New Findings (introduced or surfaced in v0.2)

### Critical
_None._

### High

- **`accept-friend` calls `accept_friendship` with wrong argument names — always falls through to non-atomic fallback**
  — `supabase/functions/accept-friend/index.ts:221-235` vs.
  `supabase/migrations/0004_r2_patches.sql:66-90`.
  The Edge Function calls the RPC with `{ p_requester_id, p_current_user, p_accepted_at }`,
  but `0004_r2_patches.sql` installs the canonical signature as
  `accept_friendship(p_requester uuid, p_accepter uuid)`. PostgREST returns
  `PGRST202 "Could not find the function"`, and the function silently
  degrades to `twoWriteFallback()` (`index.ts:258-288`). That fallback is
  exactly the race the RPC was meant to close: between the `UPDATE` to
  `status='accepted'` and the reverse `upsert`, a concurrent request that
  reads the friendship list sees a half-accepted state. More importantly,
  if the upsert fails (network blip, transient DB error), the friendship
  stays half-accepted indefinitely — only the requester's side reads as
  friends; the accepter's `listFriends()` returns nothing for that pair
  until the operation is retried.
  The migration notes this discrepancy in its tail comment (`0004_r2_patches.sql:177-184`):
  > "the Edge Fn must be updated in a follow-up patch to match … Until
  > that Edge Fn patch ships, the call will return PGRST202 'function not
  > found' and the function falls through to its safe two-write fallback,
  > so no user-visible regression occurs in the interim."
  The "no user-visible regression" framing is too generous — the fallback
  is observably non-atomic, and the whole point of the RPC was to fix that.
  **Fix:** update the Edge Function call site to
  `admin.rpc("accept_friendship", { p_requester: requesterId, p_accepter: currentUserId })`
  and drop `p_accepted_at` (the RPC uses `now()`). Ship the Edge Fn patch
  in the same release as the migration — otherwise this finding ships to
  production unfixed.

- **`add-friend` mutual-accept path is non-atomic — same race the new RPC was meant to close, but `add-friend` does not call it**
  — `supabase/functions/add-friend/index.ts:204-243`.
  When the target has already sent a pending request (mutual add), the
  function performs two sequential service-role statements: UPDATE the
  reverse row to `accepted`, then INSERT the requester's direction as
  `accepted`. The function's own comment (`index.ts:207-212`) admits:
  > "In the extremely unlikely event the second statement fails, the
  > reverse row remains 'pending' — the caller can retry and the
  > idempotency path (step 6) will re-attempt acceptance. A SECURITY
  > DEFINER RPC would give a true single-transaction guarantee; tracked
  > as a known ambiguity."
  Migration 0004 added exactly such an RPC (`accept_friendship`), but
  `add-friend` does not call it. Worse, the consequences here are stronger
  than in `accept-friend`: if the second insert fails after the reverse
  UPDATE succeeds, the *requester* sees no friendship (their direction
  never inserted) but the *target's* pending request was silently consumed
  (UPDATE'd to accepted). The target's UI now shows them friends with
  someone who has no record of friending them, and the requester's retry
  hits the idempotency check at step 6 — which finds no row for their
  direction, falls through, and would have to also pass the reverse-row
  check at step 7 (the target's row is now accepted, not pending, so
  step 7 doesn't fire) → ends up calling the plain INSERT path, which
  inserts a fresh pending row. Net state: target says accepted, requester
  says pending. Recovery requires manual DB intervention.
  **Fix:** in the mutual-add branch, call `admin.rpc("accept_friendship", { p_requester: targetId, p_accepter: user.id })`
  (or whatever signature the Edge Fn from the H-1 fix uses) instead of
  two manual statements.

### Medium

- **`add-friend` CORS defaults to `*` and echoes the request origin — bypasses the env allowlist contract**
  — `supabase/functions/add-friend/index.ts:23,62-77`.
  `ALLOWED_ORIGINS_RAW = Deno.env.get("WILDEX_ALLOWED_ORIGINS") ?? "*"` —
  if the env var is unset, the function permits any origin. Worse, the
  function does so by echoing back the request's `Origin` header verbatim
  (line 67-68), which means a missing env var is not just permissive — it's
  permissive with credentials (the request carries a Bearer JWT). This is
  inconsistent with `create-capture` and `accept-challenge`, which both
  deny when the env var is unset. The risk is concrete: a forgotten env
  var on a fresh deploy silently weakens the auth surface — any cross-tab
  or third-party site can call `add-friend` on behalf of an authenticated
  user. Combined with the H-2 mutual-add race above, a hostile site can
  spam friend requests with the victim's JWT and create stuck
  half-accepted states at will.
  **Fix:** drop the `?? "*"` default. Mirror `create-capture`'s pattern:
  empty set → deny all cross-origin. Also drop the wildcard branch and
  fall-back-to-first-allowed-origin behavior — both are footguns.

- **`accept-friend` hardcodes the CORS allowlist; ignores `WILDEX_ALLOWED_ORIGINS`**
  — `supabase/functions/accept-friend/index.ts:32-45`.
  Allowlist is literal: `https://wildex.app`, `https://www.wildex.app`,
  plus a regex for `*.vercel.app` and a prefix match for `exp://`. No
  env override. This is inconsistent with the other three functions and
  will break:
  - any Vercel deployment under a custom domain that's not `*.vercel.app`
  - any Expo dev tunnel that doesn't use the `exp://` scheme (e.g. tunnel
    URLs on `*.exp.direct`)
  - any future preview environment (`*.wildex-preview.app`, etc.)
  The function is privacy-safe (allowlist denies unknown origins, the
  function does require a Bearer JWT) but operationally fragile. A
  forgotten allowlist update will manifest as "accept friend silently
  fails in production" for users on the wrong build.
  **Fix:** parse `WILDEX_ALLOWED_ORIGINS` the same way `create-capture`
  does. Keep the hardcoded list as a fallback only if the env var is
  unset, or drop it entirely and rely on env config.

- **RevenueCat webhook `increment_inventory` fallback silently overwrites instead of incrementing**
  — `supabase/functions/revenuecat-webhook/index.ts:383-417`.
  The function calls the new `increment_inventory` RPC (which is correctly
  defined in `0004_r2_patches.sql:108-121` as additive `on conflict do
  update set quantity = inventory.quantity + excluded.quantity`). If the
  RPC is missing (PGRST202), it falls back to a plain
  `admin.from("inventory").upsert({ quantity: grant.qty }, { onConflict:
  "user_id,item" })`. **This sets quantity to `grant.qty`** — not
  additive. Repeat purchases of `wildex_lure_pack` (qty 3) silently leave
  the user with 3 lures total no matter how many they buy. With the RPC
  now installed in 0004 this is a non-issue for new deploys, but the
  fallback is still a footgun: a future schema rollback or a deploy that
  drops `0004_r2_patches.sql` but keeps the Edge Fn re-introduces the
  silent value-loss bug, and the only signal is a `console.warn` that
  ops will not see. The function also keeps writing successfully and
  returns 200 to RevenueCat, so RC will not retry — the purchase is
  silently lost.
  **Fix:** if the RPC is missing, return 500 (RC will retry) rather than
  fall back. Or replace the fallback with the same `upsert` shape but
  use `quantity = inventory.quantity + p_qty` via a raw SQL `rpc()` call.
  Either way: failing closed > succeeding wrong.

- **`accept-challenge` returns `log: []` on the idempotent-replay path — clients cannot trust replay**
  — `supabase/functions/accept-challenge/index.ts:201-213`.
  The idempotency branch (challenge already resolved) returns the stored
  `winner` + `seed` but a hardcoded empty `log`. The reviewer note at
  `0004_r2_patches.sql:127-142` adds the `challenges.log jsonb` column to
  unblock this, but `accept-challenge` is not updated in v0.2 to either
  *write* `outcome.log` on first resolve or *read* it on replay. A client
  that calls `acceptChallenge(id)` a second time gets `log: []` and either
  (a) renders an empty battle, or (b) re-simulates locally from the seed
  — but the v0.2 service layer (`services/battles.ts:213-216`) returns
  `{ winner, log: data.log }` directly with no replay-from-seed branch.
  Result: any retry of an already-accepted challenge shows an empty
  battle log to the opponent. Low security severity, but high UX
  severity, and the migration intentionally added column scaffolding
  that the Edge Fn never uses.
  **Fix:** on first resolution write `outcome.log` to `challenges.log`;
  on replay return that column instead of `[]`.

- **`captures.image_path` not added to constraints despite v0.2's tighter contract**
  — `supabase/migrations/0003_lockdown.sql` STEP 6.
  The column is renamed from `image_url → image_path` and documented as a
  Storage path (`${user.id}/${capture.id}.jpg`), but there is no CHECK
  constraint enforcing the format. A future Edge Fn bug that writes a
  raw URL or arbitrary string back into `image_path` would not be caught
  at the DB layer. The previous round's H-sec-4 fix (UUID in filename)
  is enforced *only* in the Edge Function code, not at the column level.
  **Fix:** `alter table captures add constraint captures_image_path_chk
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')`.

### Low / Informational

- **L-1: `lib/auth.ts` Google OAuth web branch still uses `window.location.origin` fallback** — `lib/auth.ts:27-32`. Same as v0.1 audit. Low risk; relies on Supabase URL allowlist. Consider failing closed.

- **L-2: `services/captures.ts` uses `new Date().toISOString()` as EXIF timestamp when client does not supply EXIF** — `services/captures.ts:128-130`. The comment honestly admits this defeats the EXIF freshness anti-cheat: any client call passes "now" as the EXIF and the server's ±5 min freshness check trivially passes. This is consistent with the README's "tier-1 anti-cheat" acknowledgement that tiers 2-5 are not implemented, but should be flagged as the Edge Fn's strongest input check is being neutered by its own service-layer caller. Either the Edge Fn should require the *real* device EXIF (and reject if the service layer can't supply it) or this anti-cheat should be dropped and marked TODO.

- **L-3: `iconicTaxon` accepted as any string in `create-capture/index.ts:258`** — `const iconicTaxon = typeof sg.iconicTaxon === "string" ? sg.iconicTaxon : ""`. No allowlist check; if the iNat API contract ever changes or a MITM substitutes the response, an unexpected `iconicTaxon` value flows into `rollStats()`. The stats engine in `_shared/engine/stats.ts` is presumably robust to unknown elements, but a server-side allowlist of valid iconic taxa would be defense-in-depth.

- **L-4: `accept-friend/index.ts:176-179` builds an `.or()` filter by string interpolation** — same fragile pattern as `services/battles.ts:239` and v0.1's `lib/multiplayer.ts:89`. Inputs are `requesterId` (validated as UUID earlier) and `currentUserId` (from JWT), so currently safe; flag for future-refactor caution.

- **L-5: `services/friends.ts:104-108` joins `profiles!friendships_friend_id_fkey` to populate friend display names** — this works because friendships rows reference `auth.users`, and `profiles` has the same UUID PK. RLS on `profiles` is `read own only` — but joining through a foreign key under the user's JWT requires that user to be able to read the joined row, which the policy forbids. This will fail at runtime: `listFriends()` will return rows with `profiles: null` for friends because the user cannot read other users' profiles. The v0.1 `add-friend`/`accept-friend` Edge Fns work because they use the service-role client; the v0.2 client-side `listFriends()` does not. Marked Low only because it's a functional bug surfacing as missing UI data, not a security leak (RLS is correctly denying), but worth fixing by adding a `profiles read friends` policy or moving the join into an Edge Fn.

- **L-6: `revenuecat-webhook` does not validate `app_user_id` is a UUID** — `parseEvent` (`index.ts:150-166`) only checks it's a string. If RevenueCat's `app_user_id` is misconfigured to a non-UUID (developer error, not attack), the downstream `profiles.update().eq("user_id", userId)` returns zero affected rows with no error — the grant is silently lost and rc_events records the event as processed. Add a UUID regex check before any DB write.

- **L-7: Apple Sign-In nonce flow still correct** — `lib/auth.ts:73-100`. Hashed nonce → Apple, raw nonce → Supabase. Closed since v0.1; still correct.

- **L-8: `0001_profiles.sql` `handle_new_user()` loop on `unique_violation` has no upper bound** — line 106-115. Collision probability is ~10^-12 per attempt so an unbounded loop is operationally fine, but a `for i in 1..10 loop` would be cheap insurance against a hypothetical RNG-broken-in-prod scenario causing infinite loops on auth signup. Cosmetic.

## RLS Coverage Verification

Tables across migrations 0001 + 0002 + (carried from schema.sql) 0003 + 0004:

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | Gaps / Notes |
|-------|-----|--------|--------|--------|--------|--------------|
| `profiles` | Yes (0001:141) | own only (0001:147) | none (revoked 0001:173) | own basic (0001:154) + col-level revoke on friend_code/is_pro/pro_until (0001:175) | none (revoked 0001:174) | **Gap:** no policy lets users read *friends'* profiles → `services/friends.ts:104-108` JOIN returns null (L-5). |
| `captures` | Yes (schema:22) | own (schema:24) | **REVOKED** in 0003:44-45 | no policy (implicit deny) | own (schema:28) | Closed Crit-1 + H-sec-5. UPDATE-via-RPC paths use SECURITY DEFINER (`feed_capture`/`age_up`/`allocate_point`). |
| `battles` | Yes (schema:43) | involved (schema:45) | no policy (implicit deny) | no policy (implicit deny) | no policy (implicit deny) | Correct — only service role writes (and no v0.2 path actually writes here yet). |
| `challenges` | Yes (schema:66) | own only (schema:212) | self + reject pre-filled resolution (0003:374-382) | accept (schema:72) gated by `protect_challenge_resolution` trigger | own + open (0003:385-390) | UPDATE policy still broad; trigger compensates. |
| `inventory` | Yes (schema:105) | own (schema:107) | revoked (schema:112) | revoked (schema:112) | revoked (schema:112) | Correct. Writes via webhook + `increment_inventory` RPC. |
| `rc_events` | Yes (schema:236) | no policies | no policies | no policies | no policies | Correct — service-role only. |
| `friendships` | Yes (0002:32) | involved (0002:36) | revoked (0002:53) | revoked (0002:53) | either side (0004:166-170, broadened from `own` in 0002:44) | DELETE broadened correctly in 0004; reasoning sound (SELECT already permits both parties). |
| `storage.objects` (`captures` bucket) | RLS via Storage policies | own folder (schema:248) | own folder (schema:253) | own folder (schema:258) | own folder (schema:263) | **Now enforced** — 0003:55-70 makes the bucket private and aborts the migration if not. Folder gate by `auth.uid()::text` correct. |
| `auth.users` | Supabase-managed | n/a | n/a | n/a | n/a | n/a |

**Coverage gaps remaining:**
1. `profiles` SELECT doesn't permit reading friends' profiles — blocks `services/friends.ts` JOIN (L-5).
2. `challenges` UPDATE policy is broad (mitigated by trigger; defense-in-depth opportunity).
3. No CHECK constraint on `captures.image_path` format (medium finding above).

## Edge Function Security Matrix

| Function | Auth | Input validation | CORS | Idempotency | Secret handling | Notes |
|----------|------|------------------|------|-------------|-----------------|-------|
| `create-capture` | JWT via anon `getUser()` | storage_path startsWith owner; taxonId int < 1e9; commonName/scientificName non-empty; score number; EXIF parseable + ≤5 min old; coords typed; HEAD-check object exists | Env allowlist, deny-by-default, 403 on unknown | None at fn level (`captures.id` collision is `crypto.randomUUID()` so vanishingly unlikely) | Service role from env; never logged | Strong. EXIF anti-cheat undermined by service layer using `new Date()` (L-2). |
| `accept-challenge` | JWT via anon `getUser()` | code regex; UUID regex on opponent_capture_id; opponent_id must match caller; opponent_capture must be caller's | Env allowlist, deny-by-default, 403 + Vary: Origin | **Yes** — already-resolved branch returns stored result, but log: [] (medium finding above) | Service role from env; error messages never echo `upErr.message` | Strong; replay returns empty log (Medium). |
| `add-friend` | JWT via anon `getUser()` | friend_code regex strict (alphabet + length); self-friend rejected | **Defaults to `*`** if env unset; echoes Origin (Medium M-2) | Step 6 idempotency check + 23505 race re-read | Service role from env; no secret comparison | CORS defective; mutual-add race (H-2). |
| `accept-friend` | JWT via anon `getUser()` | requester_id UUID regex; self-accept rejected | **Hardcoded** allowlist; no env override (Medium M-3) | Yes (both-accepted-already returns 200) | Service role from env | Calls RPC with wrong arg names → degraded path (H-1). |
| `revenuecat-webhook` | None (deployed `--no-verify-jwt`); Bearer shared secret via constant-time compare | parseEvent validates string-typed `id`/`type`/`product_id`/`app_user_id`; SKU + event type allowlists | None — webhook only; not browser-callable | `rc_events` PK insert (23505 → 200 duplicate) | `WH_SECRET` from env; `timingSafeEqual`; never logged | Strong. Fallback path silently non-additive (Medium). No HMAC (acceptable, RC limitation). |

All five functions correctly verify the JWT via `userClient.auth.getUser()`
even when deployed `--no-verify-jwt` (the flag disables Supabase's automatic
JWT enforcement at the gateway; manual verification inside the function is
both present and correct). The webhook intentionally has no JWT and relies
on the shared secret.

## What's Done Well

- **Critical fix-through is real, not cosmetic.** Both v0.1 criticals (captures
  client INSERT, public bucket) close at the *database* level: `revoke insert`
  + `drop policy`, plus an `update storage.buckets ... raise exception` that
  fails the migration loudly if the bucket isn't private. The fix is
  defensible against future deploy drift.

- **`create-capture` v0.2 is textbook.** Opaque server-issued IDs, HEAD-check
  before INSERT, env-allowlist CORS with deny-by-default, taxon ID range
  validation, typed error envelope that never leaks DB strings. The function
  feels like it was written by someone who read the audit and internalized
  each finding.

- **Constant-time secret compare is implemented correctly.** The XOR loop in
  `revenuecat-webhook` walks the full max-length buffer and pads
  out-of-bounds bytes with `0` to keep iteration count constant — the common
  mistake (short-circuit on length mismatch) is explicitly avoided.

- **Migrations are well-structured and replayable.** Every destructive step
  has a guarded `if exists` / `drop … then create`, every `do $$ exception`
  block is named, and ambiguities/spec-flags are documented in tail comments.
  Reviewing 0003 and 0004 was significantly faster than reviewing the v0.1
  `schema.sql` because the *why* is explained next to the *what*.

- **Schema-level CHECK constraints back the Edge Fn validation.** `taxon_id
  in (0, 1e9)`, `score in [0,1]`, `age ≤ 10` are enforced both in the Edge
  Fn (where a bad request returns a clean 400) and at the DB (where a
  service-role insert with bad data would still fail). Belt-and-braces.

## Recommended Next Steps

**Within this release (before deploy):**

1. **(High)** Update `accept-friend/index.ts:221-225` to call
   `accept_friendship` with `{ p_requester: requesterId, p_accepter:
   currentUserId }` — drop `p_accepted_at`. Verify the RPC executes
   (no PGRST202 in logs) and remove or keep `twoWriteFallback` as
   belt-and-braces only.

2. **(High)** Rewrite the mutual-add branch in `add-friend/index.ts:204-243`
   to call the same `accept_friendship` RPC instead of two raw statements.

3. **(Medium)** Make `add-friend` and `accept-friend` honor
   `WILDEX_ALLOWED_ORIGINS` with deny-by-default, matching `create-capture`
   / `accept-challenge`. Remove the `?? "*"` default in `add-friend` and the
   hardcoded allowlist in `accept-friend`.

4. **(Medium)** Change the `increment_inventory` fallback in
   `revenuecat-webhook/index.ts:383-417` to return 500 (let RC retry)
   instead of silently overwriting. Or remove the fallback entirely now
   that 0004 installs the RPC.

5. **(Medium)** Persist `outcome.log` into `challenges.log` on first
   resolution in `accept-challenge`, and read it back on the
   already-resolved branch. The migration already added the column.

**Soon (next sprint):**

6. **(Medium)** Add a `profiles read friends` RLS policy so
   `services/friends.ts:104-108` JOIN returns friend display names.
   Suggested: `using (auth.uid() = user_id OR auth.uid() in (select
   friend_id from friendships where user_id = profiles.user_id and status
   = 'accepted'))`. Verify it doesn't break the audit's friend-code
   enumeration guarantee — it doesn't, because the join is gated on an
   accepted friendship.

7. **(Medium)** Replace `services/captures.ts:128-130` `new Date().toISOString()`
   EXIF stub with either a real device EXIF read (use `expo-image-picker`
   exifReader) or remove the tier-1 anti-cheat and update the README.

8. **(Medium)** Add a `captures_image_path_chk` CHECK constraint enforcing
   the `${uuid}/${uuid}.{jpg,jpeg,png,webp}` format.

9. **(Low)** Tighten `challenges` UPDATE policy to specific columns
   (defense-in-depth on top of the trigger).

10. **(Low)** Add an `iconicTaxon` allowlist in `create-capture`.

11. **(Low)** Add a UUID regex check on `app_user_id` in the
    RevenueCat webhook.

**Before App Store launch:**

12. Implement anti-cheat tiers 2-5 (GPS-vs-iNat-range, liveness, server-side
    iNat re-verify, per-user trust score). Same recommendation as v0.1 —
    EXIF freshness alone is bypassable in <30 seconds.

13. Add per-email server-side magic-link rate limiting via Supabase Auth Hook.

14. Add a webhook IP allowlist for RevenueCat (or rotate `WH_SECRET` on a
    schedule via secrets management).

15. Verify `app/_layout.tsx` ErrorBoundary gates stack output behind `__DEV__`
    (not in this audit's read list — confirm separately).

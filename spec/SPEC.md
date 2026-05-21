# Wildex v0.2 — Master Spec

_Status: target spec. v0.1 is the current scaffold. v0.2 is "playable" per `DESIGN.md` roadmap._
_Owner: spec/docs lead. Audits driving this revision: `AUDIT-CODE.md`, `AUDIT-SECURITY.md`, `AUDIT-PERFORMANCE.md`, `AUDIT-ARCHITECTURE.md` (all 2026-05-20)._

---

## 1. Product Summary

Wildex v0.2 is a real-world creature collector on iOS (with a web preview build) where a signed-in player photographs wild animals, gets them identified by the iNaturalist computer-vision API, has deterministic battle stats rolled server-side from the capture, and builds a personal dex of those creatures. Players can add friends via short codes and send each other asynchronous 1v1 battles whose outcomes are resolved authoritatively on Supabase Edge Functions — never trusted from the client. v0.2 closes the live security holes flagged in the v0.1 audits (client-side `captures` INSERT, public Storage bucket, single-source-of-truth divergence between client and server engines) and makes the photo capture → dex → friend battle loop the first end-to-end playable experience.

---

## 2. v0.2 Feature List

Each feature lists user-facing description and testable acceptance criteria. Every acceptance criterion has at least one corresponding test case in `test-plan.md`.

### 2.1 Auth — Email magic-link sign-in
**Description:** A user enters their email, receives a magic link, and is signed in on tap.
**Acceptance criteria:**
- User can enter a valid email and the app sends a Supabase OTP/magic link without error.
- System enforces a per-email server-side rate limit (Supabase Auth Hook) so repeat sends within 30 s for the same email are rejected with a clear message.
- Tapping the magic link in mail returns the user to the app via the registered scheme (`wildex://` native, `EXPO_PUBLIC_REDIRECT_URL_WEB` on web) and produces a valid session.
- Edge case: malformed email is rejected client-side before the network call.
- Edge case: expired/used link surfaces a recoverable "Link expired, send another" state and does not crash.

### 2.2 Auth — Apple Sign In (iOS)
**Description:** iOS users can sign in with their Apple ID in one tap.
**Acceptance criteria:**
- User can complete Apple Sign In and land on the authenticated home screen.
- System sends a SHA-256-hashed nonce to Apple and the raw nonce to Supabase (replay defense, per audit M1) — verified by inspecting the auth call payload in tests.
- Edge case: user cancels the Apple sheet — no session is created, the sign-in screen remains usable.
- Edge case: Apple returns no email (private relay) — the session is still created and the user can use the app.
- Feature is hidden on Android and web (no broken button).

### 2.3 Auth — Google Sign In (iOS + web)
**Description:** Users can sign in with Google on iOS (native browser code-exchange) and on web (Supabase OAuth redirect).
**Acceptance criteria:**
- User can complete Google OAuth on iOS via `expo-web-browser` + `exchangeCodeForSession` and land on home.
- On web, redirect URL is read from `EXPO_PUBLIC_REDIRECT_URL_WEB` and the build fails closed at startup if the env var is missing (audit L `auth.ts:webRedirect`).
- System persists the session in `AsyncStorage` on native and the default storage on web; user remains signed in across cold starts.
- Edge case: user cancels OAuth — no session, sign-in screen recovers.

### 2.4 Capture — Real photo upload to private Storage
**Description:** When a user captures an animal, the photo is uploaded to a private Supabase Storage bucket and the resulting row in `captures` is created by the `create-capture` Edge Function.
**Acceptance criteria:**
- User can take a photo on iOS; the app calls `identifyAnimal`, shows top suggestions, and on confirm uploads the photo and writes a `captures` row.
- System rejects client-side direct `INSERT` into `captures` — the `revoke insert on captures` block in `schema.sql` is applied in v0.2 and an integration test asserts the INSERT is denied with 403/permission-denied (closes AUDIT-SECURITY Critical 1).
- System stores files under `${user.id}/${serverCaptureId}.jpg` (no `user.id` in the filename — closes AUDIT-SECURITY High "path leak").
- System enforces that the `captures` Storage bucket is **private**; a startup/CI assertion fails the deploy if it becomes public (closes AUDIT-SECURITY Critical 2).
- Edge case: upload succeeds but Edge Function fails → result card is NOT shown as savable (audit CODE Medium "Capture UX result card on save fail").
- Edge case: user denies camera permission → app shows a helpful message with a link to settings; no crash.

### 2.5 Capture — EXIF + freshness anti-cheat (tier 1 only)
**Description:** The `create-capture` Edge Function rejects photos whose EXIF `DateTimeOriginal` is missing or older than 5 minutes from server time.
**Acceptance criteria:**
- System rejects a capture with no EXIF timestamp (400 + error code `EXIF_MISSING`).
- System rejects a capture with EXIF older than the freshness window (400 + error code `EXIF_STALE`).
- System accepts a capture with a fresh EXIF timestamp within the window.
- Edge case: server is documented (in code + this spec) as accepting a client-asserted EXIF string, not parsing the image server-side. This is acknowledged tier-1 only; full server-side EXIF parsing is a v0.3 item.
- Edge case: clock skew between client and server up to 60 s does not falsely reject otherwise valid captures.

### 2.6 Capture — Server-rolled deterministic stats
**Description:** Stat blocks are generated server-side by the `create-capture` Edge Function from `(serverCaptureId, taxonId, score)` and cannot be set or rerolled by the client.
**Acceptance criteria:**
- Given the same `(serverCaptureId, taxonId, score)`, the server produces byte-identical stats across runs (determinism).
- The client-side `lib/stats.ts` and the server-side `_shared/stats.ts` produce identical output for the same inputs — enforced by a parity test in CI (closes AUDIT-CODE High "engine duplication" until full extraction).
- System rejects payloads where the client tries to send a `stats` object; only server-rolled stats are persisted.
- Edge case: `taxonId` outside the allowlist range (positive integer ≤ 10^9) is rejected (audit M `inaturalist` validation).
- Edge case: an `iconicTaxon` not in `ELEMENT_MAP` falls back to a known default `unknown` element rather than crashing.

### 2.7 Dex — View captures (list, sort, filter, detail)
**Description:** The user sees their captures as a list, can sort by date or rarity, filter by element, and tap into a detail view with stats and the photo.
**Acceptance criteria:**
- User can open the dex and see captures ordered by `created_at desc`, paginated at 50 per page.
- User can sort by rarity (legendary → common) and filter by element.
- User can tap a capture and see the photo (loaded via `signCaptureUrl`, never via the raw storage path) and full stat block.
- System enforces RLS: another signed-in user's GET cannot return rows where `user_id` differs (integration test).
- Edge case: loading state shows a spinner; error state shows a retryable message (closes AUDIT-CODE Medium "no loading state").
- Edge case: zero captures shows an empty-state CTA to "Capture your first animal".

### 2.8 Friend codes
**Description:** Each user can generate a short alphanumeric friend code, share it out-of-band, and the recipient can add them as a friend by entering it.
**Acceptance criteria:**
- User can generate a friend code (8 characters from a 32-char alphabet, ~1.1×10^12 space, cryptographically random — audit M3 confirmed; falls back to error rather than `Math.random()`).
- User can paste a friend code and on success see the other user added to a `friends` list (new table in v0.2 schema).
- System enforces uniqueness: a code maps to exactly one user; collisions retry server-side.
- System enforces RLS: a user can read only their own friends rows.
- Edge case: entering one's own code is rejected with "That's you".
- Edge case: entering an invalid/expired code shows a clear error and does not reveal whether the code ever existed.

### 2.9 Async battles — Send challenge
**Description:** A signed-in user picks one of their captures, picks a friend, and sends a battle challenge.
**Acceptance criteria:**
- User can select one capture from their roster and one friend from their friends list, then submit a challenge.
- System creates a `challenges` row with a unique code, the challenger's `user_id` and `capture_id`, and a `pending` status.
- System enforces that the challenger can only nominate captures they own (RLS + server check in the Edge Function).
- Edge case: challenger has zero captures → the "send challenge" UI is disabled with explanation.
- Edge case: friend has zero captures → challenge is still sent; the friend gets a "pick a capture to respond" state.

### 2.10 Async battles — Accept and resolve (server-validated)
**Description:** The recipient picks one of their captures to defend with; the `accept-challenge` Edge Function resolves the battle deterministically server-side and writes the result.
**Acceptance criteria:**
- Recipient can open a pending challenge, see the challenger's capture summary, pick their own capture, and submit.
- System reads both stat blocks from the DB (never trusts client-supplied stats — audit AUDIT-SECURITY High "client stat leak" / AUDIT-CODE "_stats dead param"), generates a server-chosen seed, runs `simulate()`, and writes the result via service role.
- System enforces the `protect_challenge_resolution` trigger so no client write can mutate `winner` or `result_log`.
- Client receives `{winner, log}` and animates the battle by replaying the log; the displayed outcome always matches the server result (parity test).
- Edge case: recipient tries to accept an already-resolved challenge → 409 conflict, UI shows the existing result.
- Edge case: recipient tries to accept a challenge addressed to a different user → 403.

### 2.11 iNaturalist token + paid tier check
**Description:** The app uses a registered iNaturalist API bearer token (not the anonymous endpoint) and gracefully degrades if rate limits are hit.
**Acceptance criteria:**
- System reads `EXPO_PUBLIC_INAT_TOKEN` and passes it to `identifyAnimal` when present.
- If the token is missing in production builds, the build fails at startup (analogous to the Supabase env assertion).
- System detects 429 / quota responses from iNat and shows a "Rate-limited, try again in a minute" message rather than throwing.
- Edge case: malformed iNat response is rejected client-side and surfaces a recoverable error.
- Edge case: paid-tier check — if iNat returns the higher-quota indicator, the app logs it once (so we know in production whether the paid tier is active).

---

## 3. Non-Goals (Explicitly NOT in v0.2)

These are intentionally deferred. Build agents must not implement them in v0.2.

- **Liveness check (multi-frame photo / video burst)** — v0.3
- **GPS range validation (iNat range × user lat/lng)** — v0.3
- **Server-side image re-identification** — v0.3 (tier-1 EXIF only in v0.2)
- **Push notifications for battle results** — v0.3
- **Daily quests** — v0.3
- **RevenueCat subscriptions** — v0.4 (the existing `iap.ts` and webhook stay in the repo but are NOT activated in the v0.2 release)
- **Cosmetic store** — v0.4
- **Leaderboards** — v0.4
- **Trade between players** — out of roadmap
- **Realtime presence / live battle spectating** — out of roadmap (Realtime client is dropped from the bundle per AUDIT-PERFORMANCE High #3)

---

## 4. User Flows

### 4.1 Sign up / sign in
**Email magic link:**
1. User opens the app cold; root layout checks `getSession()` from cache.
2. No session → router pushes `/sign-in`.
3. User taps "Sign in with email", enters address, taps Send.
4. App calls `signInWithEmail(email)` which calls `supabase.auth.signInWithOtp`.
5. Server-side rate-limit hook accepts (first send) → email queued.
6. User opens the link on the same device → app handles the deep link, `exchangeCodeForSession`, session stored.
7. Router pushes `/` (home).

**Apple (iOS):**
1. From `/sign-in`, user taps "Continue with Apple".
2. App generates a raw nonce, SHA-256-hashes it, calls `AppleAuthentication.signInAsync({ nonce: hashed })`.
3. On success, app calls `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: rawNonce })`.
4. Session stored, router pushes `/`.

**Google:**
1. From `/sign-in`, user taps "Continue with Google".
2. Native: open `expo-web-browser` → Supabase OAuth URL → on redirect, extract `code`, call `exchangeCodeForSession`. Web: `signInWithOAuth({ provider: 'google', redirectTo: WEB_REDIRECT })` and rely on Supabase callback.
3. Session stored, router pushes `/`.

### 4.2 Capture an animal
1. From `/`, user taps "Capture".
2. App requests camera permission if not granted.
3. User frames an animal and snaps a photo. App reads EXIF `DateTimeOriginal`.
4. App calls `identifyAnimal(uri, INAT_TOKEN)` and shows the top 3 iNat suggestions with confidence.
5. User picks a suggestion → app uploads the photo to a temporary path under `${user.id}/`.
6. App invokes `create-capture` Edge Function with `{ storage_path, suggestion, exif_datetime }`.
7. Edge Function: validates JWT, validates EXIF freshness, validates `storage_path` starts with `${user.id}/`, server-rolls stats, INSERTs the row, returns the canonical capture.
8. On success, app shows the result card with element, rarity, stat block. Tapping "Save" navigates to `/dex` (the row is already persisted; this is just navigation). On failure, the card is NOT shown as savable.

### 4.3 View dex
1. From `/`, user taps "Dex".
2. `useCaptures()` hook calls `getSession()` (cached) and runs `select(...).eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)`.
3. Loading spinner while in flight.
4. List renders cards with thumbnail (signed URL, batched via `createSignedUrls`), name, element chip, rarity chip.
5. User taps sort/filter controls → list re-renders without a new fetch (client-side filter on the page).
6. User taps a card → `/dex/[id]` detail screen shows the full image and stat block.

### 4.4 Add a friend
1. From `/`, user taps "Friends".
2. Screen shows the user's friend code (large, copyable) and an "Enter code" field.
3. **Sender flow:** user copies the code and sends it OOB (text message, etc.).
4. **Receiver flow:** user pastes the code and taps Add.
5. App calls `addFriend(code)` which calls a `lookup-friend` Edge Function (or RPC) that resolves the code → `user_id`, INSERTs into `friends`, returns the friend row.
6. List re-fetches and shows the new friend.

### 4.5 Send a battle challenge
1. From `/`, user taps "Challenge a friend".
2. Screen shows two horizontal pickers: "Your capture" (roster) and "Friend" (friends list).
3. User picks one from each, taps Send.
4. App calls `openChallenge(captureId, friendUserId)` which INSERTs a `challenges` row with status `pending`. (Note: in v0.1 challenges used a shareable code; in v0.2 challenges are addressed by `opponent_id` directly because friends exist.)
5. Confirmation screen: "Sent. You'll see the result here when they respond."

### 4.6 Accept and resolve a battle
1. Recipient sees pending challenges on `/` (badge) and opens the challenge list.
2. Recipient taps a pending challenge → sees the challenger's capture summary.
3. Recipient picks one of their own captures, taps Accept.
4. App calls `accept-challenge` Edge Function with `{ challenge_id, opponent_capture_id }`.
5. Edge Function: validates JWT, validates recipient is the addressed `opponent_id`, loads both captures' stats from DB (server-authoritative), chooses a seed (`${challengerCaptureId}:${opponentCaptureId}:${now}`), runs `simulate()`, writes `winner` + `result_log` via service role under the `protect_challenge_resolution` trigger.
6. Client receives `{winner, log}`, replays the log frame by frame as a battle animation.
7. Both users can revisit the challenge later and see the persisted result.

---

## 5. Definition of Done

v0.2 ships when ALL of the following hold:

- [ ] All v0.2 features in Section 2 have passing tests per `test-plan.md`.
- [ ] All **Critical** and **High** AUDIT-SECURITY findings dated 2026-05-20 are closed (verified by named tests in `test-plan.md`).
- [ ] All **High** AUDIT-CODE findings dated 2026-05-20 are closed: engine duplication eliminated (or parity-test-gated in CI), `_stats` removed from `acceptChallenge`, `getInventory` propagates errors.
- [ ] Deterministic engine has 100% line coverage and a parity test (`lib/` vs `_shared/`) that runs in CI.
- [ ] `npm run build:web` produces a working SPA at `dist/` deployable to Vercel.
- [ ] EAS production iOS build succeeds (`npm run build:ios`).
- [ ] All Supabase Edge Functions deploy cleanly via `supabase functions deploy`.
- [ ] `revoke insert on captures` block in `schema.sql` is applied; integration test confirms client INSERT is denied.
- [ ] `captures` Storage bucket is private; CI assertion enforces this.
- [ ] No `EXPO_PUBLIC_*` env-var fallbacks reach production (fail-closed at startup).
- [ ] README updated to reflect v0.2 commands, removing v0.1 caveats that no longer apply.
- [ ] Privacy strings in `app.json` are accurate for v0.2 features (camera, photo library — location is NOT used in v0.2 so its description must be removed or marked "v0.3 feature").

---

## 6. Out-of-Scope but Mentioned in DESIGN.md

So build agents don't accidentally implement these in v0.2:

- **Liveness check** (DESIGN §Anti-Cheat tier 3) → v0.3.
- **GPS bind / iNat range validation** (DESIGN §Anti-Cheat tier 2) → v0.3.
- **Server re-verify** (DESIGN §Anti-Cheat tier 4) → v0.3.
- **Trust score** (DESIGN §Anti-Cheat tier 5) → v0.3+.
- **Cosmetics, frames, themes** (DESIGN §Monetization 1) → v0.4.
- **Wildex Pro subscription** (DESIGN §Monetization 2) → v0.4.
- **Lure packs** (DESIGN §Monetization 3) → v0.4.
- **Push notifications** → v0.3.
- **Daily quests** → v0.3.
- **Leaderboards** → v0.4.
- **Android native build** (web is the only non-iOS target in v0.2; Android can run in Expo Go for dev, no production build).
- **RevenueCat-backed shop UI** — keep `lib/iap.ts` and `revenuecat-webhook` in the repo but hide the shop entry point in v0.2 builds.

---

## 7. Glossary

- **Capture** — A single photographed animal saved to the user's dex. One DB row in `captures` with a server-rolled stat block, an element, a rarity, and a private storage path.
- **Dex** — The user's collection of captures. Read-only list view, sortable and filterable.
- **Element** — One of `beast | avian | aquatic | reptile | insect | flora | fungal | unknown`. Derived server-side from the iNaturalist iconic taxon via `ELEMENT_MAP`.
- **Rarity** — One of `common | uncommon | rare | epic | legendary`. Derived server-side from iNat ID confidence score via `RARITY_BUDGET`.
- **Type chart** — The matchup table (`TYPE_CHART`) that multiplies attack damage by 1.0–1.4× based on attacker vs defender element. Deliberately loose so most matchups are winnable.
- **Replay verification** — The property that, given a stored `seed` + both stat blocks, the server can re-run `simulate()` and reproduce the exact same battle outcome. Underpins anti-cheat for async battles.
- **Friend code** — An 8-char alphanumeric (32-char alphabet) string unique per user, used to add a friend OOB. Generated client-side with `crypto.getRandomValues`.
- **Challenge** — A pending async battle from one user (challenger) to another (opponent), addressed by `opponent_id` (v0.2; v0.1 used shareable codes). Resolved exactly once by the `accept-challenge` Edge Function.

# Wildex Architecture Audit
_Generated: 2026-05-20_

---

## Executive Summary

Wildex is an Expo (React Native) app — not a Next.js application despite being deployed to Vercel as a static SPA. The stack is Expo Router + Supabase + iNaturalist CV API, targeting iOS-first with a web preview fallback. The overall shape is a thin two-layer system: an `app/` screen layer that calls `lib/` service functions, with Supabase Edge Functions acting as a security/game-logic layer that the client invokes but does not own. The design intent (server-authoritative stats, replay-verifiable battles, webhook-driven IAP) is sound and largely implemented — this codebase is notably post-remediation, having been through two prior audit rounds. The biggest structural concerns are (1) a critical dual-source-of-truth problem where core game logic (`BattleStats`, `Element`, `rng`, `simulate`) is copy-pasted verbatim between `lib/` and `supabase/functions/_shared/` with no mechanical guarantee of drift-free parity; (2) an absent component layer — `components/` is an empty directory and all UI primitives (cards, chip pickers, stat rows) are inlined into every screen, creating unavoidable duplication as the screen count grows; and (3) Supabase queries are scattered directly across five screens with no data-fetching abstraction, meaning auth checks, error handling patterns, and `.eq('user_id', user.id)` guards must be manually maintained in each location.

---

## Current Architecture Map

```
┌─────────────────────────────────────────────────────────────────┐
│  Client Bundle (Expo / Metro)                                   │
│                                                                 │
│  app/ (Expo Router screens)                                     │
│  ├── _layout.tsx        ErrorBoundary + GlobalErrorListener     │
│  ├── sign-in.tsx        Auth entry (email OTP / Apple / Google) │
│  ├── index.tsx          Home hub — links to all screens         │
│  ├── capture.tsx        Camera → iNat → Edge Fn → save          │
│  ├── dex.tsx            Capture list (read-only)                │
│  ├── battle.tsx         Local 1v1 picker + client sim           │
│  ├── grow.tsx           XP / age-up / stat allocation           │
│  ├── challenge.tsx      Async multiplayer (code-based)          │
│  └── shop.tsx           RevenueCat / IAP                        │
│                                                                 │
│  lib/ (service functions — imported by app/ screens)           │
│  ├── supabase.ts        Singleton client + platform adapter     │
│  ├── auth.ts            signInWith{Apple,Google,Email}, signOut │
│  ├── storage.ts         uploadCaptureImage, signCaptureUrl      │
│  ├── inaturalist.ts     identifyAnimal → IdSuggestion[]         │
│  ├── stats.ts           rollStats (deterministic, client-side)  │
│  ├── rng.ts             FNV-style PRNG shared by stats+battle   │
│  ├── battle.ts          simulate() — local battle engine        │
│  ├── multiplayer.ts     openChallenge / acceptChallenge         │
│  ├── growth.ts          feed / ageUp / allocate / getInventory  │
│  ├── iap.ts             RevenueCat wrapper (iOS only)           │
│  └── polyfills.{native,web}.ts   Platform URL polyfill          │
│                                                                 │
│  components/            EMPTY — no shared UI components         │
└────────────┬────────────────────────────┬───────────────────────┘
             │  supabase.functions.invoke  │  supabase.rpc()
             ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase Edge Functions (Deno runtime)                         │
│                                                                 │
│  functions/create-capture/index.ts                              │
│    Auth → EXIF freshness check → rollStats → INSERT (srvc role) │
│                                                                 │
│  functions/accept-challenge/index.ts                            │
│    Auth → lookup by code → load BOTH stats from DB →           │
│    simulate → write winner (service role)                       │
│                                                                 │
│  functions/revenuecat-webhook/index.ts                          │
│    Verify shared secret → idempotency → upsert inventory        │
│                                                                 │
│  functions/_shared/                                             │
│    battle.ts   ← COPY of lib/battle.ts + lib/rng.ts            │
│    stats.ts    ← COPY of lib/stats.ts + lib/rng.ts + types     │
└────────────────────────────┬────────────────────────────────────┘
                             │  Postgres + RLS + SECURITY DEFINER
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (hosted Postgres)                                     │
│                                                                 │
│  Tables: captures, battles, challenges, inventory, rc_events    │
│  RPCs:   feed_capture, age_up, allocate_point, grant_purchase   │
│  RLS:    per-user read/write on all tables                      │
│  Storage: 'captures' bucket (private, folder-namespaced)        │
└─────────────────────────────────────────────────────────────────┘

External:
  iNaturalist CV API   →  lib/inaturalist.ts (client-side call)
  RevenueCat SDK       →  lib/iap.ts (iOS native module, lazy-loaded)
  Apple Sign In        →  expo-apple-authentication
  Google OAuth         →  expo-web-browser (native) / supabase redirect (web)
```

**Dependency direction (intended):**

```
app/ → lib/ → supabase.ts → Supabase
               inaturalist.ts → iNat API
               iap.ts → RevenueCat
```

**Actual violations:** `app/capture.tsx` calls `supabase` directly (bypassing `lib/`) for auth checks alongside its `lib/storage` and `lib/inaturalist` calls. Several screens also call `supabase` directly rather than going through a lib service.

---

## Findings

### Critical structural issues

- **Dual-source-of-truth for core game logic** — `lib/battle.ts` + `lib/rng.ts` + `lib/stats.ts` vs `supabase/functions/_shared/battle.ts` + `supabase/functions/_shared/stats.ts` — The battle engine and stat-roller that must produce byte-identical output on client and server exist as **manual copies**. `_shared/stats.ts` inlines the `rng()` function rather than importing from a shared location; `_shared/battle.ts` does the same. Both files carry the comment "if you edit one, edit the other." This is not an architectural guarantee — it is a prayer. A single-character divergence (a constant, a threshold, a rounding call) between the two copies will silently corrupt the anti-cheat replay verification that is the core integrity promise of the game. There is no test that runs both implementations against the same seed and asserts equal output (`__tests__/` is empty).

  **Why it matters:** Server-side battle resolution (`accept-challenge`) is the primary anti-cheat mechanism for online play. If the client and server `simulate()` disagree on a battle result, the server's result stands but differs from what the client animated — this is both a UX break and an invisible integrity hole.

  **Recommendation:** Extract a single canonical implementation of `rng` + `rollStats` + `simulate` into a shared location that can be imported by both the Expo bundle and the Deno functions. The `_shared/` directory already exists for this purpose. Write a determinism test that runs client-lib and server-shared versions against the same inputs and asserts bitwise equality. Until a shared module system is viable between Metro and Deno, at minimum write an automated diff check in CI that rejects any content divergence between the two copies.

- **No component layer — UI primitives are inlined and duplicated across every screen** — `components/` is an empty directory. The `Roster` picker component in `app/battle.tsx:75-92` is a capture-chip horizontal scroll. An identical visual pattern exists in `app/challenge.tsx:51-61`. The stat row (`Stat` in `app/dex.tsx:59-65`) is duplicated-in-spirit in `app/grow.tsx`. The "card with rarity border" pattern exists in `app/dex.tsx` and implicitly in `app/grow.tsx`. All design tokens (colors `#7be39a`, `#0b1d12`, `#0f2418`, `#2bbd6a`, `#9fb9aa`, `#e7f5ec`) are magic strings repeated across eight files.

  **Why it matters:** Adding a new screen (leaderboard, friend profile, trade) will require copy-pasting layout primitives and color constants. A design-token change (dark mode, brand refresh) requires touching every screen file. The `Roster` component divergence between `battle.tsx` and `challenge.tsx` is already happening — `challenge.tsx` shows `stats.element + stats.rarity` while `battle.tsx` shows `ageLabel(age) + stats.element`, with no shared contract.

  **Recommendation:** Extract at minimum: (1) a `CaptureChip` component covering the picker card pattern, (2) a `StatRow` component for the HP/ATK/DEF/SPD/SPC display, (3) a `theme.ts` constants file for all color values and spacing. This unblocks consistent design evolution without per-screen surgery.

### Significant concerns

- **Supabase queries are scattered directly across five screens with no data-fetching abstraction** — `app/dex.tsx:18-29`, `app/battle.tsx:23-34`, `app/challenge.tsx:17-27`, `app/grow.tsx:21-33`, `app/index.tsx:10-18` each contain inline IIFE `useEffect` blocks that call `supabase.auth.getUser()` then `supabase.from('captures').select(...)`. The auth check, the `.eq('user_id', user.id)` guard, and the error-handling (or absence of it) must be replicated manually each time. Each screen defines its own local `Capture` type with slightly different field sets (e.g., `battle.tsx:8-14` includes `age` and `allocated`; `dex.tsx:6-12` does not; `challenge.tsx:7` excludes both).

  **Why it matters:** Five independent locations must be kept in sync when the auth model changes, when RLS policies are tightened, or when capture columns are added. The divergent `Capture` types mean a field added to the DB is not automatically surfaced to screens — it must be added to each `select(...)` call and each local type definition separately. Error states are currently swallowed silently in most screens.

  **Recommendation:** Extract a `useCaptures(fields)` hook that encapsulates auth resolution, the `user_id` guard, error state, and loading state. Consolidate the `Capture` type into a single canonical definition in `lib/` (or generate it from Supabase types). Consider `supabase gen types typescript` to eliminate manual type maintenance entirely.

- **The `captures.stats` column is JSONB with no runtime schema validation on the client read path** — `app/dex.tsx:42`, `app/battle.tsx:9`, `app/grow.tsx:10` all cast the raw Supabase row to a typed `Capture` that includes `stats: BattleStats`. This cast is `as Capture` with no validation — if the stored JSONB is missing a field (e.g., `allocated` defaulting to `{}` on old rows before the migration at `schema.sql:95`), the screen silently renders `undefined` for stat values. The schema migration adds `allocated jsonb not null default '{}'::jsonb` but the TS type on the client side (`Record<Stat, number>`) expects every stat key to be present.

  **Why it matters:** Database migrations that add/change JSONB shape are invisible to the TypeScript type system. Each migration becomes a hidden compatibility break for existing rows.

  **Recommendation:** Add a thin Zod or hand-rolled validator in `lib/` that sanitizes raw Supabase rows before exposing them to screens. Alternatively, use Supabase's generated TypeScript types and treat the JSONB columns as `unknown`, narrowing them explicitly.

- **`create-capture` Edge Function performs EXIF freshness check on the server but also accepts the EXIF timestamp from the client payload** — `supabase/functions/create-capture/index.ts:76-80` parses `body.exif_datetime` (a client-supplied string) and compares it to `Date.now()`. The client at `app/capture.tsx:80` reads `photo.exif?.DateTimeOriginal` and sends it. A client that omits or fabricates `exif_datetime` is rejected, but a client that sends a freshly-forged timestamp string passes. The EXIF value is never cross-checked against server-side image metadata extraction.

  **Why it matters:** EXIF freshness is described as "Tier 1 anti-cheat." As implemented it is a client-assertion freshness check, not an EXIF freshness check. It closes the "laziest cheating" (sending no timestamp) but not a trivially patched client.

  **Recommendation:** Document explicitly in `create-capture/index.ts` that this is a client-assertion check, not server-verified EXIF parsing. Track it as a known gap on the roadmap. The fix (Tier 2+) is to run the image through a server-side EXIF parser (Sharp, or a Deno image library) after downloading it from Storage.

- **`lib/multiplayer.ts:60` — `acceptChallenge` passes `_stats` but the parameter is unused** — The function signature is `acceptChallenge(code: string, captureId: string, _stats: BattleStats)`. The stats parameter is prefixed with `_` (intentionally unused) because the server now reads stats authoritatively from the DB. However, `app/challenge.tsx:41` still passes `picked.stats` from the client-side capture object. This is dead coupling: the parameter exists in the public API but carries no data. Callers may be confused about whether stats are actually client-provided.

  **Recommendation:** Remove the `_stats` parameter from `acceptChallenge` entirely. Update the call sites. This clarifies the architectural contract: the client submits only IDs; the server resolves the rest.

### Worth considering

- **`lib/growth.ts:58-108` mixes two distinct concerns** — business-logic constants (`FEED_XP`, `STAT_LABEL`, `POINTS_PER_AGE_UP`) are co-located with Supabase RPC calls (`feed`, `ageUp`, `allocate`, `getInventory`) and a shop catalog (`SHOP` array). The shop catalog in `growth.ts` (with hardcoded price strings) is not used by `app/shop.tsx` — the shop screen uses RevenueCat packages from `lib/iap.ts`. The `SHOP` constant is dead code.

  **Recommendation:** Remove the unused `SHOP` export from `growth.ts`. Consider splitting `growth.ts` into a pure-logic module (`growthRules.ts`: constants, `xpToNextAge`, `ageLabel`, `effectiveStats`) and a data module (`growthService.ts`: Supabase RPCs).

- **`lib/iap.ts` is not initialized anywhere visible** — `initIAP(rcApiKey, appUserId?)` must be called before `getOfferings()` or `purchase()`. There is no call to `initIAP` in `app/_layout.tsx` or `app/shop.tsx`. The `shop.tsx` screen calls `getOfferings()` directly in a `useEffect`, which on iOS will fail silently (RevenueCat SDK not configured) and trigger the "not configured" warning branch only if `EXPO_PUBLIC_RC_API_KEY` is missing from env.

  **Why it matters:** A new developer wiring up the IAP key will get mysterious failures until they discover that `initIAP` must be called at app startup.

  **Recommendation:** Call `initIAP(process.env.EXPO_PUBLIC_RC_API_KEY!, userId)` from `app/_layout.tsx` after session resolution, or add a clear comment to `app/shop.tsx` explaining the initialization dependency.

- **The `revenuecat-webhook` SKU map and the `lib/iap.ts` `PRODUCT_GRANTS` map are separate** — `lib/iap.ts:13-16` maps `wildex.growth_treat_5` and `wildex.age_tonic_1`. `revenuecat-webhook/index.ts:23-28` maps `wildex_age_tonic`, `wildex_age_tonic_5`, `wildex_lure_pack`, `wildex_pro_monthly`. These two maps use different SKU naming conventions (dots vs underscores) and different product sets. This is not necessarily wrong (the client map keys are App Store product IDs; the webhook map keys are RevenueCat product identifiers) but it is undocumented and will confuse anyone wiring up a new SKU.

  **Recommendation:** Add inline comments clarifying that client-side product IDs (App Store) and RevenueCat webhook product IDs may differ, and document where each value comes from (App Store Connect vs RevenueCat dashboard).

- **The web deployment target (`vercel.json`) and the app's primary target (iOS) create dual-platform pressure with no explicit feature-flagging layer** — Platform differences are handled inline via `Platform.OS === 'web'` / `Platform.OS === 'ios'` branches scattered through `app/capture.tsx`, `app/sign-in.tsx`, `app/shop.tsx`, `lib/auth.ts`, `lib/iap.ts`, `lib/storage.ts`, and `lib/supabase.ts`. There is no feature-flag or capability module that centralizes what works where.

  **Recommendation:** Consider a `lib/capabilities.ts` module that exports named booleans (`canUseCamera`, `canUseIAP`, `canUseAppleSignIn`, etc.) derived from `Platform.OS` and env vars. This makes it trivial to audit cross-platform support at a glance and to add Android support later without hunting for every `Platform.OS === 'ios'` branch.

---

## Module Boundary Analysis

### `app/` (screens)

**Cohesion:** High — each file is one screen, files are named after their route, and there is no logic that could not reasonably belong in a screen component. The `Roster` helper in `battle.tsx:75-92` is the only non-screen export, and it belongs in `components/`.

**Coupling:** Elevated. Screens import from `lib/supabase` directly (not mediated through a lib service) for auth checks and data fetches. `app/capture.tsx` imports from `lib/inaturalist`, `lib/storage`, and `lib/supabase` — three lib modules for one operation. This is reasonable for a prototype but creates broad coupling.

**Leakage:** `app/battle.tsx` defines a local `Capture` type at line 8. `app/challenge.tsx` defines another at line 7. `app/dex.tsx` defines another at line 6. `app/grow.tsx` defines another at line 7. Four different `Capture` types with different field sets, all derived from the same DB table. This is type-definition leakage: the canonical shape lives nowhere, and any of the four can drift silently.

### `lib/` (service functions)

**Cohesion:** Moderate. `lib/growth.ts` is the weakest: it owns game constants, Supabase RPCs, UI label generation (`ageLabel`), stat computation (`effectiveStats`), and a dead shop catalog. `lib/auth.ts` is well-scoped. `lib/supabase.ts` is correct as a singleton with platform-specific configuration. `lib/rng.ts` is a clean single-export module.

**Coupling:** `lib/multiplayer.ts` imports `lib/supabase` and `lib/stats` (for the type only). `lib/growth.ts` imports `lib/supabase` and `lib/stats`. `lib/storage.ts` imports `lib/supabase`. `lib/auth.ts` imports `lib/supabase`. This is a clean hub-spoke pattern with `supabase.ts` at the center — no circular dependencies.

**Leakage:** `lib/stats.ts` is used both as a client-side stat roller (called from `create-capture` Edge Function conceptually, but actually its logic is duplicated into `_shared/stats.ts`) and as a type source (`BattleStats` is imported by `battle.ts`, `growth.ts`, `multiplayer.ts`). The type-import usage is clean; the logic duplication is the leakage.

### `supabase/` (Edge Functions + schema)

**Cohesion:** High. Each Edge Function has a single responsibility and its directory name matches its API endpoint name. The `_shared/` directory is the right place for shared Deno-compatible code.

**Coupling:** `_shared/stats.ts` inlines `rng()` instead of importing it (Deno self-containment constraint). `_shared/battle.ts` does the same. This is a platform constraint (Deno cannot import from the Metro/npm bundle) but creates the dual-source-of-truth problem.

**Leakage:** `schema.sql` functions (`feed_capture`, `age_up`, `allocate_point`) duplicate business rules that also live in `lib/growth.ts`. The `xpToNextAge` formula at `schema.sql:143` (`60 * power(age, 1.3)`) must match `lib/growth.ts:33` (`60 * Math.pow(Math.max(1, currentAge), 1.3)`). The `Math.max(1, ...)` guard added to the client lib is absent from the SQL function — `age` has a `check (age >= 1)` constraint that enforces the same invariant at the DB level, making this safe in practice but invisible without reading both files.

### `components/` (shared UI)

Empty. No boundary to analyze — this is the gap.

---

## Implicit Decisions Worth ADRs

**1. The client simulation is decorative, not authoritative.**
`lib/battle.ts` and `lib/rng.ts` exist in the client bundle and are called from `app/battle.tsx` for local battles. For online battles, `supabase/functions/accept-challenge` runs the server-authoritative simulation and returns a result+log. The client is supposed to replay the log for animation. This architectural decision — client sim for UX, server sim for authority — is sound but undocumented. Any future developer seeing `simulate()` called in `app/battle.tsx` will assume it is authoritative for local battles too. There is no ADR capturing: (a) what "local battle" means vs "online battle," (b) whether local results are recorded anywhere, (c) whether local battles are a separate game mode or a development shortcut.

**2. Supabase anon key in the client bundle is intentional, not a secret leak.**
`lib/supabase.ts` bundles `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` into the client. This is the standard Supabase architecture: the anon key is public by design, and security is enforced entirely by RLS + SECURITY DEFINER functions. `.env.local` in the repo (currently committed; should be gitignored but is not excluded from the working tree) contains the real anon key. The decision to accept the anon key being visible in the bundle needs to be captured, along with the implication: the security perimeter is Row Level Security, not key secrecy. Every future schema change must be reviewed through the RLS lens.

**3. The Expo web export is a marketing preview, not a peer platform.**
`vercel.json` deploys the Metro web bundle as a single-page app. `app/capture.tsx:18-27` explicitly tells web users to use the iOS app. `lib/iap.ts` no-ops on web. `lib/auth.ts` has a separate Google OAuth path for web. This is a deliberate tiered-platform decision: web for previews/sign-up/dex viewing; iOS for the core gameplay loop. This is not documented, so it is easy to accidentally route camera/IAP feature work onto the wrong platform. An ADR should capture which features are web-supported and why the web exists at all.

**4. `captures.image_url` stores a storage path, not a URL.**
The column is named `image_url` in `schema.sql:16` and in the Edge Function at `create-capture/index.ts:100` (comment: "storage path, NOT public URL"). Every screen that wants to display a capture image must call `signCaptureUrl(path)` first. But `dex.tsx`, `battle.tsx`, `grow.tsx`, and `challenge.tsx` do not render capture images at all — they never call `signCaptureUrl`. This decision (store path, sign on demand) is correct and follows Supabase best practices for private buckets, but the column name is misleading. An ADR (or at minimum a DB column comment) should document the convention: "this column stores a Supabase Storage path; call `signCaptureUrl()` before rendering."

**5. Business-critical game logic lives in a single `schema.sql` file with no migration versioning.**
`schema.sql` is designed to be "replayable from scratch" (README line 17). The 2026-05-19 security migration block is appended inline. There are no numbered migration files, no Supabase CLI migration history, no timestamps on individual migration blocks beyond the inline comments. A partial apply (running only some sections) is invisible. The `revoke insert on captures` block is commented out and must be manually uncommented after a specific deploy step — this is an operational sequencing dependency that cannot be enforced by schema tooling. This decision (single-file schema vs migration files) should be made explicit so the team knows whether they are maintaining a "always re-runnable snapshot" or whether they intend to move to `supabase migration` files as the project matures.

---

## What's Done Well

- **The server-side battle and capture architecture is well-designed.** The `accept-challenge` Edge Function authoritatively resolves battles by reading stats from the DB (never from the client payload), generates a server-chosen seed, and writes the result via service role. The `protect_challenge_resolution` trigger in `schema.sql:204-225` provides a third enforcement layer beyond RLS. The layered defense (RLS + trigger + service-role-only writes) is the right pattern for a competitive game.

- **Platform-specific code is isolated and documented.** `lib/polyfills.native.ts` / `lib/polyfills.web.ts` are resolved by Metro's platform extension mechanism rather than inline `Platform.OS` branches. `lib/supabase.ts` handles the AsyncStorage adapter cleanly and documents why. `lib/auth.ts`'s Google OAuth native path using `expo-web-browser` + `exchangeCodeForSession` is the correct pattern and is well-commented. The `lib/iap.ts` lazy-import of `react-native-purchases` prevents the native module from being evaluated in web context.

- **The `rng.ts` single-module PRNG is correct and well-justified.** Using `Math.imul` for FNV-1a avoids the float-overflow bug that plagues naive JS implementations of the same algorithm. The comment explaining why this matters (`lib/rng.ts:8-9`) is exactly the kind of institutional knowledge that prevents regressions. The seed format for battles (`captureA:captureB:timestamp`) is deterministic given the stored seed value and enables server-side replay.

---

## Recommended Refactors

Listed in priority order (impact x effort):

1. **Write a determinism test for the dual game-logic copies.** [Critical — low effort] Create `__tests__/determinism.test.ts` that imports `lib/battle.ts`, `lib/stats.ts`, and `lib/rng.ts` on the client side, and reproduces (or imports) the `_shared/` versions, then runs 100 seeded battles/stat rolls and asserts equal output. This is the only way to catch drift before it reaches production. No refactor needed — just a test.

2. **Extract shared UI primitives into `components/`.** [High — medium effort] At minimum: `CaptureChip` (the picker card used in `battle.tsx` and `challenge.tsx`), `StatRow` (hp/atk/def/spd/spc display used in `dex.tsx` and `grow.tsx`), and `theme.ts` (color constants). This directly unblocks leaderboard, friend profile, and trade screens without copy-paste debt.

3. **Introduce a `useCaptures` hook and a canonical `Capture` type.** [High — medium effort] Replace the four inline IIFE `useEffect` fetch blocks across `dex.tsx`, `battle.tsx`, `challenge.tsx`, and `grow.tsx` with a shared hook that handles auth, the `user_id` guard, loading, and error state. Move the canonical `Capture` type (with all columns, using Supabase generated types) to `lib/types.ts`.

4. **Remove the `_stats` parameter from `acceptChallenge`.** [Medium — trivial effort] `lib/multiplayer.ts:60`. The parameter is already unused (prefixed `_stats`). Removing it makes the architectural contract explicit: callers submit capture IDs only; the server resolves everything else.

5. **Fix `captures.image_url` column naming or add a DB comment.** [Medium — low effort] Rename the column to `image_path` or add a Postgres `COMMENT ON COLUMN` clarifying it is a storage path, not a URL. Update the TypeScript types and all references accordingly. This prevents the next developer from calling `getPublicUrl` on it.

6. **Move `schema.sql` to Supabase CLI migration files.** [Medium — medium effort] Split the current monolithic `schema.sql` into numbered migration files (`supabase/migrations/20260517_initial.sql`, `20260519_security_patch.sql`, etc.). This gives the team `supabase db diff`, `supabase db reset`, and migration history without manual comment-reading. The commented-out `revoke insert` block becomes a separate migration that can be applied as part of the Edge Function deploy step.

7. **Add `initIAP` call to `_layout.tsx` or document the initialization requirement.** [Low — trivial effort] Currently `lib/iap.ts` requires `initIAP()` before any other IAP call, but it is called from nowhere. Either call it at app startup (after session resolution) or add a prominent comment in `app/shop.tsx` explaining the dependency.

8. **Add a `lib/capabilities.ts` feature-flag module.** [Low — low effort] Centralize all `Platform.OS === 'ios'` and env-var-presence checks behind named boolean exports (`canUseCamera`, `canUseIAP`, `canUseAppleSignIn`, `isWebPreview`). This makes cross-platform feature coverage auditable without reading all eight files that contain `Platform.OS` branches.

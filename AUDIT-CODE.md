# Wildex Code Quality Audit
_Generated: 2026-05-20_

---

## Executive Summary

Wildex is a compact, well-scoped Expo (React Native) + Supabase app. The current state of the codebase reflects significant remediation work since the prior audit: the score-scale bug, session-persistence gap, snap error handling, and Rules-of-Hooks violation from that audit have all been resolved, as have the most critical multiplayer and storage issues. TypeScript strict mode is enabled, the auth flows are correctly implemented, and the Edge Functions handle auth, validation, and server-side stat rolling well. The most significant remaining code-quality concerns are (1) the duplication of the entire battle engine and stat-rolling logic between `lib/` and `supabase/functions/_shared/` — a silent drift risk that will eventually cause client/server divergence — (2) a handful of `any` casts and unsafe runtime-to-TypeScript bridges that are partially self-justified but are tightenable, and (3) missing loading and error UI states across several screens.

---

## Findings

### 🔴 Critical

_None found._

---

### 🟠 High

- **Full engine duplication between client and server** — `lib/battle.ts`, `lib/rng.ts`, `lib/stats.ts` vs. `supabase/functions/_shared/battle.ts`, `supabase/functions/_shared/stats.ts`
  Both `_shared/battle.ts` and `_shared/stats.ts` inline their own copy of the FNV `rng()` function verbatim rather than importing from a shared source. Additionally, `rollStats`, the `ELEMENT_MAP`, `RARITY_BUDGET`, `ELEMENT_BIAS`, and the full `TYPE_CHART` are each defined twice. A change to any constant in one file (e.g. a rarity threshold or type-effectiveness multiplier) will silently diverge client and server simulations, corrupting replayability without any compile-time signal. The root cause is that Edge Functions run in Deno and cannot import from the RN-targeted `lib/` tree. Recommended fix: extract pure-logic into `supabase/functions/_shared/engine.ts` + `supabase/functions/_shared/rng.ts`, import those in the Edge Functions, and have `lib/` re-export from them via a path alias or a parity test in CI that asserts identical output for a fixed seed set.

- **`_stats` parameter in `acceptChallenge` is dead code and misleading** — `lib/multiplayer.ts:60`
  The parameter is `_stats: BattleStats` (the underscore signals intentional non-use). The server correctly reads stats from the DB. However the caller at `app/challenge.tsx:41` still passes `picked.stats` to it, and the parameter remains in the public function signature, creating a footgun: a future developer who is unaware of the server-authority design might reintroduce a client-stat path inside the function. Remove the parameter from the signature and update the call site.

- **`getInventory()` silently swallows Supabase errors** — `lib/growth.ts:87-89`
  The function destructures `{ data }` and ignores the `error` return. If the call fails (network, expired token, missing RLS row) the caller receives `{}` with no indication of failure. Both `app/grow.tsx` and `app/shop.tsx` then display "Treats: 0 / Tonics: 0" as if the user has no items. Add `const { data, error } = ...; if (error) throw error;` and propagate to the screen.

---

### 🟡 Medium

- **`any` cast for unhandled-rejection reason** — `app/_layout.tsx:39`
  `(e.reason as any)?.message` — the `as any` cast is unnecessary; use `e.reason instanceof Error ? e.reason.message : String(e.reason)`, which is the same pattern already used correctly in `app/capture.tsx:92`.

- **`any` annotation for `globalThis` in `genCode`** — `lib/multiplayer.ts:28`
  `const g: any = globalThis` is used to reach `crypto.getRandomValues`. Targeting ES2020+ (which Expo 52 does via Metro) makes `globalThis.crypto` typed directly. The `Math.random()` fallback on line 30 is also cryptographically weak — if it fires it produces non-secure codes with no warning. Remove the `any` alias and either drop the fallback or replace it with a `console.warn` + throw.

- **Duplicate `Capture` type defined in four screens** — `app/dex.tsx:6-12`, `app/battle.tsx:8-14`, `app/challenge.tsx:7`, `app/grow.tsx:7-15`
  Each screen defines a local `Capture` interface (slightly different fields per screen) and casts Supabase `data` to it with `as Capture[]`. A shared `types/capture.ts` — or Supabase-generated types via `supabase gen types typescript` — would eliminate the four parallel definitions and the unsafe casts, and would catch schema drift at compile time.

- **No loading state in data-fetching screens** — `app/dex.tsx`, `app/grow.tsx`, `app/battle.tsx`, `app/challenge.tsx`
  The `useEffect`/async fetch pattern completes asynchronously, but none of these four screens render an indicator while the fetch is in flight. The user sees the empty-list fallback ("No captures yet. Go find something.") until data arrives. `app/capture.tsx` already uses `<ActivityIndicator>` correctly. Add a `loading` boolean state and a spinner to the other screens.

- **`refresh()` not stable in `challenge.tsx` and `grow.tsx`** — `app/challenge.tsx:16`, `app/grow.tsx:21`
  Both `refresh` functions are `async` functions defined inside the component body and called from event handlers. They are recreated on every render. Wrapping with `useCallback` eliminates unnecessary recreation and prevents stale-closure issues if they are ever passed as props.

- **`SHOP` array exported but never consumed** — `lib/growth.ts:92-107`
  `SHOP` is a typed array of shop-item definitions with hardcoded USD price strings (`'$0.99'`, `'$2.99'`). No screen imports it — `app/shop.tsx` fetches live offerings from RevenueCat. This dead export contains hardcoded price strings that will diverge from actual localized store pricing over time. Either remove it or mark it clearly as a dev-only reference with a comment explaining it must not be displayed to users.

- **`MAX_TURNS` is a raw literal repeated in both engine copies** — `lib/battle.ts:37`, `supabase/functions/_shared/battle.ts:46`
  The turn limit `200` appears as a bare literal in both files. A mismatch between the two copies would silently produce different-length battle logs, breaking replay. Extract as `const MAX_TURNS = 200` in each file (and in the shared engine file once the duplication is resolved).

- **Capture UX: result card shown even when save fails** — `app/capture.tsx:57-98`
  `setResult(suggestions)` is called at line 57 before the upload and Edge Function call. If the upload or function call fails, the ID card ("Add to dex" button) is already rendered. Tapping "Add to dex" navigates to `/dex` even though the capture was never persisted. Reset `result` on any failure path, or defer `setResult` until after the successful function response.

- **`signCaptureUrl` exported but never called from any screen** — `lib/storage.ts:48-52`
  The function is correctly implemented and well-commented, but no screen calls it. If a developer later adds `<Image source={{ uri: capture.image_url }}>` using the raw storage path, they will get a 403 from the private bucket. Add a note in the export comment (or an ESLint rule) flagging direct use of `image_url` without going through `signCaptureUrl`.

- **`CORS: Access-Control-Allow-Origin: "*"` on Edge Functions** — `supabase/functions/accept-challenge/index.ts:24-28`, `supabase/functions/create-capture/index.ts:24-28`
  Both functions allow any origin. Auth via JWT bearer token mitigates cross-site risk for data mutation, but restricting to the known web origin is low-effort and closes the surface. Use an `ALLOWED_ORIGIN` env var and validate `req.headers.get("Origin")`.

- **RevenueCat webhook inventory grant does not increment — it replaces** — `supabase/functions/revenuecat-webhook/index.ts:75-79`
  The upsert sets `quantity: grant.qty` as a fixed value. If the same user has existing stock and a webhook fires (or retries), the quantity is overwritten to `grant.qty` rather than incremented. Use a SQL-level increment via an RPC or `quantity = inventory.quantity + EXCLUDED.quantity` in the ON CONFLICT clause.

---

### 🟢 Low

- **Inline async IIFE in `useEffect` repeated across screens** — `app/index.tsx:11`, `app/dex.tsx:18`, `app/battle.tsx:23`
  The `useEffect(() => { (async () => { ... })(); }, [])` pattern appears in several places. Extracting the async body into a named function or a shared `useSupabaseQuery` hook reduces visual nesting and makes individual call sites easier to test and reason about.

- **`photo.exif?.DateTimeOriginal as string | undefined` unsafe cast** — `app/capture.tsx:85`
  The `exif` field on `CameraPicturedAsset` is typed as `Record<string, unknown> | null | undefined` in expo-camera v16. The cast is defensively correct but can be expressed without `as`: `typeof photo.exif?.DateTimeOriginal === 'string' ? photo.exif.DateTimeOriginal : undefined`.

- **`fnErr as any` cast** — `app/capture.tsx:89`
  `String((fnErr as any).message ?? fnErr)` — `FunctionsHttpError` and related types all extend `Error`, so `.message` is already typed. The `as any` is unnecessary; use `fnErr.message` directly.

- **Inconsistent error feedback: some screens Alert, others only `console.error`** — `app/dex.tsx:27`, `app/battle.tsx:33`, `app/grow.tsx:29`
  `capture.tsx` shows `Alert.alert` on failure. The other screens only call `console.error`, leaving the user with no feedback on fetch failure. Adopt a consistent pattern (Alert, inline error state, or a shared toast) across all screens.

- **`auth.ts:webRedirect()` falls through to `window.location.origin` in production** — `lib/auth.ts:12-13`
  The comment says "In production the env var MUST be set," but the fallback is still reachable. A startup assertion — analogous to the one in `supabase.ts:11-18` — would make the misconfiguration fail immediately rather than silently redirect to a potentially wrong origin.

- **`initIAP` is implemented but never called** — `lib/iap.ts:18-23`
  RevenueCat requires `Purchases.configure()` before `getOfferings()`. There is no call site in the codebase. The expected location is `app/_layout.tsx` on startup, guarded by `Platform.OS === 'ios'` and `process.env.EXPO_PUBLIC_RC_API_KEY`. Without this, `getOfferings()` will throw on every cold start on a real device, and the shop will always be empty.

- **`ageLabel` does not guard `age > MAX_AGE`** — `lib/growth.ts:36-41`
  Age values above 10 return `'Apex'` correctly, but the function implicitly relies on the DB constraint to prevent `age > 10` rather than stating the invariant. A `if (age >= MAX_AGE) return 'Apex';` using the exported constant makes the relationship explicit and removes the hidden dependency.

- **Array index used as `key` for battle log lines** — `app/battle.tsx:63`
  `result.log.slice(-10).map((l, i) => <Text key={i} ...>)` — use `l.turn` as the key since it is unique within a battle and stable across re-renders.

- **`supabase/functions/README.md` deploy instructions reference the old `challenge_id` interface** — `supabase/functions/README.md:5, 29`
  The README still describes the function as accepting `{ challenge_id, opponent_capture_id }`, but the deployed `accept-challenge/index.ts` accepts `{ code, opponent_capture_id }`. The README also describes the client calling `simulate()` locally, which is no longer the case. Update to match the current interface.

---

## What Is Done Well

- **Deterministic PRNG is correctly implemented.** The `Math.imul`-based FNV hash in `lib/rng.ts` (and its inline copies) is sound. The comment explaining why `Math.imul` is required over plain multiplication is the right level of documentation for a subtle correctness trap.

- **Auth flows are thoroughly implemented.** The Apple Sign-In SHA-256 nonce binding, the Google OAuth native code-exchange via `expo-web-browser`, the explicit redirect URL handling, and the correct `AsyncStorage` adapter on native vs. `undefined` on web are all handled correctly. These are well-known footguns that this codebase avoids.

- **Edge Function security posture is solid.** All three functions authenticate via JWT, read stats from the DB rather than trusting the client payload, namespace storage paths by `user.id` with server-side re-validation, and perform defense-in-depth checks in addition to RLS. The EXIF freshness check in `create-capture` is a meaningful anti-cheat measure for a prototype, and the idempotency logic in the RevenueCat webhook is correctly implemented.

---

## Recommended Next Steps

1. **Eliminate engine duplication (High)** — Extract `rng`, `rollStats`, and `simulate` into `supabase/functions/_shared/engine.ts` as pure functions. Import from it in both Edge Functions. Add a parity test (Deno-runnable) that asserts identical output for a fixed `(captureId, suggestion, seed)` triple to catch any future drift.

2. **Remove `_stats` from `acceptChallenge` (High)** — Update `lib/multiplayer.ts:60` and `app/challenge.tsx:41`. This removes a misleading dead parameter from a public API that currently signals a design that was superseded.

3. **Fix `getInventory` silent-error swallow (High)** — Add `if (error) throw error` in `lib/growth.ts:88` and propagate error state to `app/grow.tsx` and `app/shop.tsx` so inventory fetch failures are visible to the user.

4. **Fix the RevenueCat webhook inventory increment (Medium)** — Replace the `upsert` with a DB-level increment to prevent quantity overwrite on duplicate or rapid-fire purchases.

5. **Wire `initIAP` and add loading states to screens (Medium/Low)** — Call `initIAP` from `app/_layout.tsx` on startup so the shop is functional on device. Add `loading` boolean state and a spinner to `dex.tsx`, `grow.tsx`, `battle.tsx`, and `challenge.tsx`.

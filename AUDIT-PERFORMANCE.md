# Wildex Performance Audit
_Generated: 2026-05-20_

> **Stack reality check.** The audit brief said "Next.js (Vercel-deployed)." This repo is **not** a Next.js app — it is an **Expo Router (~v4) / React Native (0.76) / react-native-web (0.19)** project, exported to a **static SPA** via `expo export --platform web` and served from Vercel as plain HTML+JS in `dist/`. There is no Next.js, no SSR/SSG/ISR/PPR, no Server Components, no Server Actions, no Cache Components, no `next/image`, no `next/font`, no Edge/Node Functions on Vercel, no middleware. The Vercel deployment is a static rewrite-everything-to-/index.html SPA (`vercel.json:5-7`). All Next-specific recommendations are therefore N/A; the perf framework that actually applies is **(a) Metro web bundle size**, **(b) SPA cold-boot before first paint**, **(c) Vercel static asset caching**, and **(d) Supabase round-trip count from the client**. Everything below is scoped to that reality.

## Executive Summary

Wildex's web target is a **single ~1.26 MB / ~341 KB-gzipped Metro bundle** (`dist/_expo/static/js/web/entry-f7865bec86892eaf01ac7d57793c0570.js`) that ships before the user sees anything except a green background, because the HTML shell is empty (`dist/index.html:34`) and the script tag uses `defer` with no SSR. The biggest wins are all upstream of "render": **(1) splitting per-route code** so capture/battle/shop/IAP code doesn't load on the sign-in screen, **(2) pruning native-only modules** from the web bundle (`expo-camera`, `expo-location`, `@react-navigation/elements` icons, `react-native-purchases` types, Supabase realtime), and **(3) adding long-cache + immutable headers** in `vercel.json` so the 1.26 MB bundle is served once per hash. Secondary wins are eliminating an N+1-style auth round-trip on every screen mount, deduping `supabase.auth.getUser()` calls, and adding a static favicon + splash so FCP isn't 100% script-driven. The data layer is small and indexed; nothing in Supabase is currently a perf bottleneck. Posture: **mediocre cold-boot, fine warm**, with a high ceiling because none of the obvious wins have been applied.

---

## Findings by Impact

### High impact (do first)

- **Single monolithic web bundle — no route-level code splitting**
  `dist/_expo/static/js/web/entry-f7865bec86892eaf01ac7d57793c0570.js` (1262 KB raw / 341 KB gzipped, 720 Metro modules)
  Expo Router web is configured with `"output": "single"` (`app.json:35`), which builds **one bundle for every route**. The sign-in page (`app/sign-in.tsx`) pulls in `@supabase/supabase-js` + `expo-camera` + `react-native-purchases` types + battle/growth/multiplayer code even though none of those screens are visible yet. Impact: **TTI ≈ bundle parse + execute time on the slowest device**; on a mid-tier mobile CPU 1.26 MB of Metro-wrapped JS is roughly **600-1200 ms of script eval before first paint** on top of the network cost.
  Fix: switch `app.json` to `"output": "static"` (Expo Router will then per-route render + split) or `"output": "server"` if you want SSR; rebuild and verify in `dist/_expo/static/js/web/`. Static will also give every route an HTML file so FCP stops being script-blocked.
  Expected: -40 to -60% gzipped bytes on first route, FCP improvement on the order of 400-1000 ms on 4G.

- **Native-only / unused modules are being bundled for web**
  `lib/supabase.ts:1-7`, `app/capture.tsx:1-2`, `app/shop.tsx:3`, `lib/storage.ts:25-27`
  The web bundle string-grep confirms `@supabase/*`, `expo-camera`, `expo-location`, `@react-navigation/*`, `react-native-screens`, and `react-native-purchases` references reach `dist/`. `capture.tsx` does an unconditional top-level `import { CameraView } from 'expo-camera'` and `import * as Location from 'expo-location'` even though its web branch returns a "not supported" stub (`app/capture.tsx:18-27`). `shop.tsx` imports the `PurchasesPackage` type and the iOS-only guard at runtime (`app/shop.tsx:3, 36`), so the bundler still keeps the module reference graph.
  Fix:
    1. Replace the top-of-file imports in `capture.tsx` with `Platform.OS === 'web'`-guarded **dynamic** `import()` calls (you already do this for `expo-apple-authentication` in `app/sign-in.tsx:14-16` and for `expo-web-browser` / `expo-file-system` / `base64-arraybuffer` in `lib/auth.ts:21-24, 64` and `lib/storage.ts:25-27` — apply the same pattern here).
    2. Drop the `PurchasesPackage` type import in `shop.tsx` (use `any` for the package param or define a local minimal type) so the entire `react-native-purchases` module graph drops from the web build.
    3. Add `metro.config.js` `platforms` aliases / `resolver.blockList` for `react-native-purchases` and `expo-camera` on web if dynamic-import doesn't fully remove them.
  Expected: -80 to -200 KB gzipped from the entry bundle (`react-native-purchases` alone pulls a non-trivial native-shim layer; `expo-camera` web shim adds getUserMedia plumbing that's never used).

- **`@supabase/supabase-js` ships the Realtime client even though Wildex never uses it**
  `lib/supabase.ts:7, 24-31`
  `createClient` from `@supabase/supabase-js` (~2.45) eagerly imports `realtime-js` (WebSocket + phoenix-style channel code). The codebase has zero `.channel()` / `.on('postgres_changes')` / `.subscribe()` calls — Realtime is dead weight in the bundle.
  Fix options: (a) import from the modular sub-packages — `@supabase/auth-js`, `@supabase/postgrest-js`, `@supabase/storage-js`, `@supabase/functions-js` — and assemble a minimal client; or (b) Metro `resolver.alias` for `@supabase/realtime-js` to a stub. (a) is cleaner and supported.
  Expected: -30 to -60 KB gzipped, and removes a long-lived WebSocket connection budget on web.

- **No HTTP cache headers on hashed static assets**
  `vercel.json:1-8`
  The bundle filename is content-hashed (`entry-f7865bec86892eaf01ac7d57793c0570.js`), so it's safe to serve with `Cache-Control: public, max-age=31536000, immutable`. Current `vercel.json` sets none — Vercel's default for static files is reasonable but not `immutable`, and the SPA rewrite catches everything. Repeat visits and SPA navigation re-paying for parse on revisit is unnecessary.
  Fix: add a `headers` block in `vercel.json`:
  ```json
  "headers": [
    { "source": "/_expo/static/(.*)", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ]},
    { "source": "/assets/(.*)", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ]}
  ]
  ```
  And ensure `/index.html` is NOT cached aggressively (it changes when the bundle hash changes). The rewrite at `vercel.json:5-7` rewrites everything to `/index.html` — that's fine for SPA routing but means you must serve `index.html` with `Cache-Control: no-cache` or `max-age=0, must-revalidate` so the new hashed asset URLs are discovered after a deploy.
  Expected: near-zero JS cost on warm navigation across the SPA; ~200-500 ms saved on returning visits on 4G.

- **Empty HTML shell — FCP is 100% script-driven**
  `dist/index.html:28-37`
  `<div id="root"></div>` is the entire visible body. The user sees the browser default white (or `#0b1d12` only after CSS-in-JS hydrates) until the 341 KB-gzipped bundle parses and the React tree renders. There is no above-the-fold static placeholder, no inline critical CSS painting the brand background, and no `<link rel="preload">` for the entry script.
  Fix: inject an inline `<style>` setting `html, body, #root { background: #0b1d12; }` and an inline SVG/text "Wildex" so FCP fires on the first paint of the HTML, not after script eval. Also add `<link rel="preload" as="script" href="/_expo/static/js/web/entry-….js">` so the browser doesn't have to wait for HTML parse to start fetching. Expo Router's `head` API or a custom `dist/index.html` template (Metro `web/index.html`) can host this.
  Expected: FCP drops from "script-execution-bound" (~800-1500 ms on 4G mid-tier) to "first byte + first paint" (~200-400 ms). LCP improves by the same margin since the LCP element is currently the title text inside the React tree.

- **Auth check round-trip on every screen mount (`getUser()` calls hit the network)**
  `app/index.tsx:13`, `app/dex.tsx:19`, `app/grow.tsx:22`, `app/battle.tsx:25`, `app/challenge.tsx:17`, `app/capture.tsx:65`, `lib/storage.ts:13`, `lib/multiplayer.ts:37, 61, 84`, `lib/auth.ts` (no caching)
  `supabase.auth.getUser()` validates the JWT with the auth server every call — it is **not** the same as `getSession()` which reads from local storage. Every screen mount does at least one round-trip before the first query fires; some screens do two or three (grow/dex fetch user, then run their own query). On a 4G connection that's +200-500 ms of TTFB-equivalent latency stacked sequentially in front of the data query.
  Fix: build a tiny in-process auth context (React Context or a small store) that calls `supabase.auth.getSession()` once at root (`app/_layout.tsx`) and subscribes to `onAuthStateChange`. Pass `user.id` down via context. Use `getUser()` only when you need to **verify** identity (e.g., before a sensitive mutation), not just to read the id for a SELECT filter (the `.eq('user_id', user.id)` is already defense-in-depth; RLS gates the actual auth).
  Expected: -200 to -500 ms TTI on every screen navigation; one less request per screen.

### Medium impact

- **`app/grow.tsx` does N+1 work on every refresh**
  `app/grow.tsx:21-32, 35-48`
  Every feed / age-up / allocate handler ends with `refresh()`, which re-fetches the full captures list AND the entire inventory. With 20 captures and frequent button taps you can easily fire 5-10 full table refetches per minute. The RPCs (`feed_capture`, `age_up`, `allocate_point` in `supabase/schema.sql:117-177`) already RETURN the updated capture row — but the client throws it away and refetches.
  Fix: have `feed/ageUp/allocate` in `lib/growth.ts:58-85` return the updated capture, then splice it into local state (`setItems((prev) => prev.map(c => c.id === updated.id ? updated : c))`). Only refresh inventory when an item-consuming RPC ran.
  Expected: -1 Postgres round-trip per interaction (10-100 ms each), smoother UI, and lighter Supabase egress.

- **`listMyChallenges()` uses `or(challenger_id.eq, opponent_id.eq)` without an index that matches the OR**
  `lib/multiplayer.ts:88-92`, `supabase/schema.sql:64` (`challenges_players_idx` is a **composite** `(challenger_id, opponent_id)`)
  A composite `(challenger_id, opponent_id)` index does **not** help an `OR` between the two columns — Postgres will plan a seq scan or two separate index scans + BitmapOr. With small data this is fine; once challenges grows past a few thousand rows it becomes the bottleneck.
  Fix: replace the composite index with two single-column indexes: `create index challenges_challenger_idx on challenges(challenger_id, created_at desc);` and `create index challenges_opponent_idx on challenges(opponent_id, created_at desc);`. The planner will BitmapOr them efficiently.
  Expected: O(log n) per side of the OR instead of seq scan once you have real traffic; query time stays sub-50 ms even at 100k+ challenges.

- **No `select` projection limits on the dex/roster reads — every row ships JSONB stats blob**
  `app/dex.tsx:22-26`, `app/grow.tsx:24-28`, `app/battle.tsx:27-31`, `app/challenge.tsx:19-23`
  All four screens do `select('…, stats, …')` and pull the entire JSONB `stats` column. That's fine for ≤ 20 captures, but `app/dex.tsx` has no `.limit()` and orders by `created_at desc` — a user with 500 captures sends 500 JSONB blobs over the wire on every visit to the dex.
  Fix: add `.limit(50)` (or a paged view with `range()`); for the battle roster it's already limited to 20 (`app/battle.tsx:31`, `app/challenge.tsx:23`) so just fix dex.
  Expected: bounded response size, predictable mobile data usage, faster `FlatList` first paint.

- **Apple icon / favicon / splash are not configured for web**
  `app.json:6-15`, `dist/index.html` (no favicon link, no apple-touch-icon, no theme-color)
  Browsers will fire a 404 for `/favicon.ico` on every cold visit (one wasted request); iOS Safari will show a generic icon when added to home screen. No `<meta name="theme-color">` means the browser chrome doesn't match the brand `#0b1d12` background, contributing to the "flash of white" feel.
  Fix: drop a `favicon.ico` in `dist/` (or `web/` for Metro) and let Expo Web pick it up; set `app.json` `web.favicon` (Expo will copy it). Add `<meta name="theme-color" content="#0b1d12">` to the HTML template.
  Expected: removes 404, improves perceived load, sub-10 KB cost.

- **Polyfill loaded on web is a no-op but still costs a module slot**
  `lib/polyfills.web.ts:1-5`, `lib/supabase.ts:4`
  The dual-platform polyfill scheme is correct (web no-op, native loads the URL polyfill). Just a note: confirm Metro's per-platform resolution is actually picking `polyfills.web.ts` over `polyfills.native.ts`. If both end up bundled (Metro can be finicky with `.native.ts` vs `.web.ts` precedence), the web bundle will include `react-native-url-polyfill` and break Safari (as the comment in `lib/polyfills.web.ts:1-5` warns).
  Fix: verify by grepping the built bundle for `react-native-url-polyfill` — currently absent based on my grep, so this is just a "keep an eye on it" item.

### Low impact / nice-to-have

- **No `React.memo` on `Roster` / `Stat` sub-components**
  `app/battle.tsx:75-92` (`Roster`), `app/dex.tsx:59-66` (`Stat`)
  `Stat` is rendered 5× per capture per render of the dex FlatList; `Roster` is rendered twice on every battle screen tick (picker A + picker B share data but re-render independently when either selection changes). The component bodies are cheap, so this is a micro-opt — but on the dex with 50+ items the `Stat × 5` re-render adds measurable scroll-frame cost on low-end devices.
  Fix: wrap `Stat` and `Roster` in `React.memo`. For `Stat` the props are primitives; for `Roster` you'd need `useCallback` on `onPick`.
  Expected: smoother scroll on low-end Android web, no measurable effect on iOS Safari.

- **`FlatList` in `dex.tsx` has no `getItemLayout` / `windowSize` tuning**
  `app/dex.tsx:32-56`
  The cards are roughly fixed-height (~140 px). Providing `getItemLayout` makes scroll initialization O(1) instead of O(n) and removes blank-cell flicker during fast scroll.
  Fix: add `getItemLayout={(_, i) => ({ length: 140, offset: 140 * i, index: i })}`.
  Expected: minor (smoothest on long lists).

- **`setSent`/`setCooldown` re-render the whole sign-in page on every tick**
  `app/sign-in.tsx:19-23`
  The `setInterval` decrement causes a re-render every second while the resend cooldown is active. Cheap, but extractable into a memoized `<Cooldown>` component so the Apple/Google buttons don't re-evaluate.
  Fix: extract the cooldown counter into its own component or `useDeferredValue`.
  Expected: negligible.

- **Console errors are still wired in production**
  `app/_layout.tsx:33-46, 13`, multiple `app/*.tsx` `console.error` calls
  These are fine in dev but in prod they cost a small main-thread tax on hot error paths (e.g., when offline). Strip with a Metro transform or a `__DEV__` guard.

- **Inline `StyleSheet.create` per file is fine, but `monoFont` is computed at module-eval**
  `app/_layout.tsx:7`
  Trivial. Noted only because the comment marks it as "Audit M18" — the fix is correct, just confirming.

- **Vercel deployment uses `framework: null`**
  `vercel.json:4`
  Correct for a non-Next/non-framework static site; just confirms Vercel won't try to auto-detect Next.js. Worth keeping pinned to avoid future "Vercel detected Next" surprises if `next` ever sneaks into deps.

---

## Rendering Strategy Review

The brief asked about SSR/SSG/ISR/PPR per route. **None of those apply** — this is a pure SPA. The current strategy is "client-side render everything after JS loads." Per route group:

| Route                     | Current                      | Best fit on this stack                                                                              | Recommendation                                                                                   |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/` (Home)                | CSR, auth-gated              | CSR is correct (auth-gated, personalized).                                                          | Move auth check to a root `_layout` provider so child routes don't re-fetch (`app/index.tsx:10-22`). |
| `/sign-in`                | CSR                          | **Static prerender** would let the form render before JS — but Expo Router single-output blocks it. | After switching to `output: 'static'`, this becomes the only static-friendly route in the app.   |
| `/capture`                | CSR (web shows "not supported") | CSR. Web fallback should not bundle camera code at all.                                          | Make the web stub a tiny separate file with no `expo-camera` import (see High-impact #2).        |
| `/dex`, `/grow`, `/battle`, `/challenge`, `/shop` | CSR, auth-gated, user-specific | CSR is correct.                                                                          | All would benefit from per-route bundle splitting (currently impossible with `output: single`).   |

Net: the right rendering migration is **Expo Router `single` → `static`** in `app.json:35`. That alone enables real per-route bundles + per-route HTML files, and is the structural change that unlocks every other "ship less JS" finding.

---

## Bundle & Asset Analysis

**Total `dist/` size:** ~1.4 MB (1.3 MB is one JS file; 72 KB is icons; 1.2 KB is HTML).

**Entry bundle composition (inferred from grep + dep list):**
- `react-native-web` + React 18 runtime: ~120-150 KB gzipped (unavoidable baseline)
- `@supabase/supabase-js` (auth + postgrest + storage + functions + **realtime**): ~70-90 KB gzipped — Realtime is dead code (~30-50 KB of that).
- `expo-router` + React Navigation core + elements + screens shims: ~50-70 KB gzipped — `@react-navigation/elements` icons get bundled even when unused (`dist/assets/node_modules/@react-navigation/elements/...`).
- App code (`app/*.tsx`, `lib/*.ts`): probably 15-30 KB gzipped — small.
- `expo-camera` web shim + `expo-location` web shim: ~10-20 KB gzipped — both confirmed in bundle, neither used on web.
- Misc Metro runtime + polyfills: ~30-40 KB.

**Heaviest avoidable items, ranked:**
1. Realtime client (`@supabase/realtime-js`) — ~30-50 KB gzipped — High-impact fix #3.
2. `expo-camera` + `expo-location` web shims — ~10-20 KB gzipped — High-impact fix #2.
3. Route-level splitting will move 100-200 KB off the initial route into lazy chunks — High-impact fix #1.

**Asset handling:**
- 17 PNG icons in `dist/assets/node_modules/*/assets/` (all <5 KB each, all unused on web — they're React Navigation header icons referenced by name even if the header is hidden). No optimization needed; their total is 72 KB.
- No fonts bundled. The app uses `Platform.select` to pick `Menlo`/`monospace` for the error overlay (`app/_layout.tsx:7`); the brand font is the browser default. **No FOIT/FOUT risk** because no custom fonts are loaded. If you ever add a brand font, use `<link rel="preload" as="font" ... crossorigin>` and `font-display: swap`.
- No `<img>` tags or rich media on the web route. The only "images" are the splash icon (`assets/splash.png`, currently empty per `ls -la assets/`) and the missing favicon.
- `assets/` directory at repo root is empty (`ls assets/` returns nothing), yet `app.json:8, 11` references `./assets/icon.png` and `./assets/splash.png`. The build still succeeds because Expo's defaults kick in; the production icon/splash will be Expo's placeholder unless real PNGs are added. **This is a small but real perf issue: the splash screen on iOS/Android adds ~200-500 ms to perceived cold start; on web a missing favicon costs a 404.**

---

## Data Layer

**Supabase schema (`supabase/schema.sql`)** — generally clean:
- All RLS-enabled. `captures(user_id, created_at desc)` indexed correctly for dex/roster reads (`schema.sql:19`).
- `captures(taxon_id)` indexed (`schema.sql:20`) — useful for future leaderboards.
- `challenges(code)` unique index (`schema.sql:63`) is used by `accept-challenge` Edge Function — correct.
- `challenges(challenger_id, opponent_id)` composite (`schema.sql:64`) — **suboptimal**; see medium-impact #2.
- `inventory` primary key is `(user_id, item)` — correct for the upsert pattern in `lib/growth.ts:87-90` and `supabase/functions/revenuecat-webhook/index.ts:75-79`.
- Server-side `feed_capture` / `age_up` / `allocate_point` RPCs (`schema.sql:117-177`) are `SECURITY DEFINER` with `FOR UPDATE` row locks — correct for the concurrent-mutation pattern; no perf concern at current scale.

**Client query patterns:**
- No `select('*')` anywhere — every screen picks specific columns. Good.
- No N+1 in loops — all reads are single-statement.
- No request deduplication / caching layer (no SWR, no React Query, no `unstable_cache` because that's a Next.js primitive). Every screen mount re-fetches from scratch. On a CSR SPA this is the norm, but a tiny `lib/cache.ts` keyed by `(table, user.id, args)` with a 30 s TTL would cut dex/grow/battle revisit latency to ~0.

**Edge Functions** (`supabase/functions/*`): all three are single-shot POSTs, no perf concern, well-bounded query graphs (1 SELECT + 1 UPDATE/INSERT each). `accept-challenge` does two SELECTs (challenge + both captures via `.in()`) — already optimal.

**Storage:** `signCaptureUrl` (`lib/storage.ts:48-52`) is currently unused by the rendering screens (dex doesn't show images yet — `app/dex.tsx` has no `<Image>`). When you add image rendering, sign URLs in batch (`createSignedUrls` plural) instead of one-per-row to avoid N round-trips.

---

## What's Done Well

- **Per-platform polyfill split** (`lib/polyfills.{web,native}.ts`) — explicit, defended in comments, avoids the Safari `URL` crash. Textbook.
- **Dynamic imports for native-only modules** in `lib/auth.ts:21-24, 64`, `lib/iap.ts:20-21, 28, 35, 51`, `lib/storage.ts:25-27`, and `app/sign-in.tsx:14-16` — exactly the right pattern. The fix in High-impact #2 is to extend this to `expo-camera` / `expo-location` in `app/capture.tsx`.
- **Defense-in-depth `.eq('user_id', user.id)` filters** on every captures read — annotated as "audit H-sec-6" in comments. Doesn't help perf directly but means RLS isn't doing redundant work on the read path.
- **Tight Edge Function scope**: each function does one thing, validates input, uses service role only where required, idempotency where it matters (`revenuecat-webhook` dedupes by `event_id`).
- **Build output is deterministic and content-hashed** — ready for aggressive immutable caching the moment you add the `vercel.json` headers block.

---

## Recommended Next Steps

Prioritized perf improvement plan (each estimated against current baseline):

1. **Switch Expo Router from `output: single` to `output: static`** (`app.json:35`). Single biggest unlock. Rebuild and confirm per-route chunks exist in `dist/_expo/static/js/web/`. _ETA: 30 min change + 1 hr regression test. Impact: -40-60% gzipped JS on first route, FCP -400-1000 ms._
2. **Add `vercel.json` `headers` block** for `/_expo/static/**` and `/assets/**` (`Cache-Control: public, max-age=31536000, immutable`) and explicitly `no-cache` for `/index.html`. _ETA: 5 min. Impact: ~0 JS cost on warm visits._
3. **Make `expo-camera` / `expo-location` lazy on web** in `app/capture.tsx` (`Platform.OS === 'web'` early-return; dynamic-import for native). Drop the `PurchasesPackage` type import in `app/shop.tsx:3`. _ETA: 30 min. Impact: -80-200 KB gzipped._
4. **Compose a leaner Supabase client** by importing `auth-js` + `postgrest-js` + `storage-js` + `functions-js` directly instead of the umbrella `@supabase/supabase-js` package — drop Realtime. _ETA: 1-2 hr. Impact: -30-50 KB gzipped, no WebSocket connection._
5. **Add an inline HTML shell** with brand background + "Wildex" headline + `<link rel="preload" as="script">` for the entry bundle. Edit the Metro `web/index.html` template (Expo Router supports this). _ETA: 1 hr. Impact: FCP -400-1000 ms._
6. **Build a root auth provider in `app/_layout.tsx`** that calls `getSession()` once + subscribes to `onAuthStateChange`. Replace all per-screen `getUser()` reads with context. _ETA: 2 hr. Impact: -200-500 ms TTI per screen navigation, -1 request/screen._
7. **Skip the refetch in `app/grow.tsx`** — splice RPC return values into local state instead of calling `refresh()`. _ETA: 30 min. Impact: -1 round-trip per interaction._
8. **Add real `favicon.ico`, `apple-touch-icon.png`, `<meta name="theme-color">`.** Fill in `assets/icon.png` + `assets/splash.png` so the brand isn't blank. _ETA: 30 min. Impact: kills the favicon 404, fixes home-screen install, ~50-150 ms perceived load._
9. **Add single-column indexes on `challenges(challenger_id, created_at desc)` and `challenges(opponent_id, created_at desc)`** to replace the composite. _ETA: 5 min migration. Impact: future-proofing — no measurable impact at current scale._
10. **Wrap `Stat` / `Roster` in `React.memo` + add `getItemLayout` to dex `FlatList`.** _ETA: 20 min. Impact: smoother dex scroll on low-end devices._

After 1-6, expect cold-load FCP from ~1.0-1.5 s down to ~0.3-0.5 s on 4G mid-tier, and TTI from ~1.5-2.5 s down to ~0.7-1.0 s. Warm reloads will be effectively instant (HTML round-trip + cached JS parse only).

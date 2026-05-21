# Wildex

Photograph real wild animals, get them identified by the iNaturalist computer-vision API, build a personal dex, and send asynchronous 1v1 battles to friends — resolved authoritatively on Supabase Edge Functions. v0.2 is the first end-to-end playable target; the photo → dex → friend battle loop is server-trusted and the v0.1 security holes (client-side capture INSERT, public Storage bucket, client/server engine divergence) are closed.

Stack: Expo (React Native) for iOS + web preview, Supabase (Postgres + Storage + Edge Functions) for the backend, iNaturalist for species ID, Vercel for the web build.

## Quick start

```bash
git clone <repo-url> wildex
cd wildex
npm install
cp .env.example .env.local
# fill in EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
#         EXPO_PUBLIC_INAT_TOKEN, EXPO_PUBLIC_REDIRECT_URL_WEB
npm run web        # fastest preview — no native build needed
```

For iOS use `npm run ios` (requires a dev client — see "iOS dev client" below for RevenueCat / Apple Sign-In).

## Environment variables

All client vars are `EXPO_PUBLIC_*` (Expo inlines them at bundle time). Missing required vars fail closed at startup in production builds.

| Var | Where | Required | Purpose |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | client | yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | client | yes | Supabase anon key |
| `EXPO_PUBLIC_INAT_TOKEN` | client | yes in prod | iNaturalist bearer token |
| `EXPO_PUBLIC_REDIRECT_URL_WEB` | client | yes on web | OAuth callback URL for web Google sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | edge fns | yes | Set automatically by Supabase |
| `REVENUECAT_WEBHOOK_SECRET` | edge fns | yes | Shared secret for webhook auth |
| `WILDEX_ALLOWED_ORIGINS` | edge fns | yes | CORS allowlist (comma-separated) |

## Supabase setup

1. **Create a project** at supabase.com. Grab the project URL and anon key into `.env.local`.

2. **Run migrations in order** from the SQL editor (or `supabase db push` if you use the CLI):

   ```
   supabase/migrations/0001_profiles.sql       — adds profiles + friend_code generator
   supabase/migrations/0002_friendships.sql    — adds friendships table + policies
   supabase/migrations/0003_lockdown.sql       — revokes client INSERT on captures,
                                                 privatizes storage bucket, RLS hardening
   supabase/migrations/0004_r2_patches.sql     — index fixes, challenge tightening,
                                                 growth RPC signature fixes
   ```

   Each file is idempotent. Apply them in numeric order — `0003_lockdown.sql` depends on `create-capture` being deployed first (see step 4) because it revokes client-side INSERT.

3. **Create the `captures` Storage bucket** and mark it **PRIVATE**. Migration `0003_lockdown.sql` enforces this with `update storage.buckets set public = false where id = 'captures'` and a CI check fails the deploy if it ever flips back to public.

4. **Deploy the five Edge Functions.** The engine sync step must run first (see "Engine sync" below):

   ```bash
   npm run sync-engine
   supabase functions deploy create-capture       --no-verify-jwt
   supabase functions deploy accept-challenge     --no-verify-jwt
   supabase functions deploy add-friend           --no-verify-jwt
   supabase functions deploy accept-friend        --no-verify-jwt
   supabase functions deploy revenuecat-webhook   --no-verify-jwt
   ```

   Each function verifies the caller JWT itself (the webhook uses a shared secret instead). Deploy `create-capture` **before** applying migration `0003_lockdown.sql`, otherwise new captures will 403.

5. **Set Supabase secrets:**

   ```bash
   supabase secrets set REVENUECAT_WEBHOOK_SECRET="$(openssl rand -hex 32)"
   supabase secrets set WILDEX_ALLOWED_ORIGINS="https://wildex.app,https://*.vercel.app,exp://"
   ```

6. **Enable auth providers** in the Supabase dashboard (Authentication → Providers):
   - **Email** — magic link, default settings.
   - **Apple** (iOS only) — bundle ID, services ID, key ID, team ID, .p8 key.
   - **Google** — separate client IDs for web and native (iOS).

   Then Authentication → URL Configuration: lock Site URL and Redirect URLs to your prod domain plus known Vercel preview patterns. v0.2 closes the open-redirect risk flagged in `AUDIT-SECURITY.md` H-sec-5.

## iNaturalist

The free `/v1/computervision/score_image` endpoint works for development. For production, register an app at inaturalist.org/users/api_token and set `EXPO_PUBLIC_INAT_TOKEN` — `services/inatService.ts` passes it through. The app detects 429 / quota responses and surfaces a "rate-limited, try again in a minute" message rather than throwing.

## Engine sync workflow

The deterministic game engine (`engine/rng.ts`, `engine/stats.ts`, `engine/battle.ts`, `engine/types.ts`) is the single source of truth for stat rolls and battle simulation. Both the Metro bundle (client) and the Deno Edge Functions (server) import it — bit-for-bit identical, or async battles desync.

Run `npm run sync-engine` to copy `engine/` into `supabase/functions/_shared/engine/` before any `supabase functions deploy`:

```bash
npm run sync-engine             # one-shot copy
npm run check:engine            # CI gate — fails on any byte-level drift
```

The `predeploy:functions` hook in `package.json` calls `sync-engine` automatically. CI runs `check:engine` on every PR; if you edit `engine/` without re-syncing, the build fails loud.

## Testing

```bash
npm test                  # one-shot run
npm run test:watch        # watch mode for local dev
npm run test:coverage     # generates coverage report
```

**100% coverage is required on `engine/`** — every public function in `rng`, `stats`, and `battle` is tested for determinism plus an engine-parity test that imports both `engine/*` and `supabase/functions/_shared/engine/*` and runs 200 seeded battles asserting identical winners and identical log entries. This test gates every merge to main.

Other suites:
- `__tests__/services/*` — service-layer error paths against mocked Supabase.
- `supabase/tests/rls.test.ts` — RLS smoke tests against a local `supabase start` instance.

## iOS dev client

`react-native-purchases@8` (used by `services/iapService.ts`) bundles a native module and is **not** compatible with Expo Go. You need a development build to test IAP or Apple Sign-In locally. RevenueCat does not publish an Expo config plugin, so we don't add one to `app.json` — autolinking picks the module up when the dev client is built via EAS.

```bash
npm i -g eas-cli
eas login
eas build:configure

# One-off dev client for local IAP / Apple Sign-In testing:
eas build --profile development --platform ios

# Production iOS build for the App Store:
npm run build:ios
```

You'll need an Apple Developer account ($99/yr) to submit. Web (`npm run web`) and Android Expo Go work fine for everything except IAP and Apple Sign-In.

## Web build & Vercel

```bash
npm run build:web         # outputs to dist/
```

Deploy `dist/` to Vercel. `vercel.json` ships immutable cache headers for `/_expo/static/*` and `/assets/*` and `no-cache` for `index.html`. `app.json` uses `output: "static"` so each route gets its own JS chunk — the sign-in page no longer ships the camera, IAP, or battle engine.

## Files

```
app/                              Expo Router screens (groups: (auth), (app), (social))
  (auth)/sign-in.tsx              email OTP + Apple + Google
  (app)/index.tsx                 home hub
  (app)/capture.tsx               camera → iNat → create-capture
  (app)/dex.tsx                   capture list
  (app)/dex/[id].tsx              capture detail + growth
  (app)/battle.tsx                local 1v1 (decorative)
  (app)/(social)/friends.tsx      friend code add/list
  (app)/(social)/challenges.tsx   pending + resolved challenges
  (app)/(social)/challenge/[id].tsx  accept flow
  (app)/shop.tsx                  RevenueCat (hidden in v0.2)

components/                       CaptureChip, StatRow, RarityBadge, LoadingSpinner,
                                  ErrorMessage, theme.ts

hooks/                            useAuth, useCaptures, useBattle, useChallenges,
                                  useFriends, useInventory, useGrowth (React Query)

engine/                           pure deterministic game logic — no I/O, no React, no SDKs
  rng.ts  stats.ts  battle.ts  types.ts

services/                         I/O boundary — one file per external system
  authService.ts        captureService.ts    challengeService.ts
  growthService.ts      inatService.ts       iapService.ts
  storageService.ts

lib/                              infra singletons only
  supabase.ts  capabilities.ts  polyfills.{native,web}.ts

scripts/                          sync-engine.ts, check-engine-drift.ts

supabase/
  migrations/                     0001_profiles → 0002_friendships → 0003_lockdown → 0004_r2_patches
  functions/                      create-capture, accept-challenge, add-friend,
                                  accept-friend, revenuecat-webhook
  functions/_shared/engine/       GENERATED — do not edit (sync-engine target)

__tests__/                        engine determinism + parity, service error paths
```

## Audits

The v0.2 build is driven by six read-only audits at the repo root:

- `AUDIT-CODE.md` — code quality, dead params, error swallowing (R6.0).
- `AUDIT-SECURITY.md` — RLS, Storage, secrets, CORS (R6.0).
- `AUDIT-PERFORMANCE.md` — bundle size, Realtime drop, indexes (R6.0).
- `AUDIT-ARCHITECTURE.md` — layering, engine sharing, type duplication (R6.0).
- `AUDIT-CODE-v2.md` — second-pass code review (R6.6, written in parallel with R6.7).
- `AUDIT-SECURITY-v2.md` — second-pass security review (R6.7, written in parallel with R6.6).

The v2 audits were produced concurrently and may flag overlapping issues; resolve by the higher-severity finding.

## Roadmap

`DESIGN.md` holds the battle design, anti-cheat tiers, and monetization plan. v0.2 (current target) covers tier-1 EXIF freshness, async friend battles, and the security/architecture rewrite. v0.3 adds liveness, GPS-range validation, server-side re-identification, and push. v0.4 turns on RevenueCat subscriptions, cosmetics, and leaderboards. The `spec/` directory holds the binding specs (`SPEC.md`, `data-model.md`, `architecture.md`, `test-plan.md`) that build agents code to.

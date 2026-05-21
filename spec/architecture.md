# Wildex v0.2 Architecture Spec

_Written: 2026-05-20. Target: build wave coders. Status: binding decisions._

---

## 1. Target Architecture Overview

Wildex v0.2 is a four-layer system. The UI layer (Expo Router screens) speaks only to hooks. Hooks coordinate domain logic and data access but own no UI primitives. The domain layer holds pure, platform-agnostic logic — specifically the game engine — and is the single canonical source imported by both the Metro bundle and the Deno Edge Functions. Infrastructure handles all I/O: Supabase client, iNaturalist HTTP, RevenueCat SDK, and platform capabilities.

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Layer  (app/)                                               │
│  Expo Router screens — render only, call hooks, own no data     │
│  components/ — shared primitives: CaptureChip, StatRow, theme   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ hooks only
┌──────────────────────────▼──────────────────────────────────────┐
│  Hooks Layer  (hooks/)                                          │
│  useAuth, useCaptures, useBattle, useChallenges, useFriends     │
│  React Query for server state; AuthContext for identity         │
└────────────┬────────────────────────────┬───────────────────────┘
             │ pure fn calls              │ service calls
┌────────────▼────────────┐  ┌───────────▼───────────────────────┐
│  Domain Layer           │  │  Services Layer  (services/)       │
│  engine/                │  │  captureService, battleService,    │
│    rng.ts               │  │  challengeService, growthService,  │
│    stats.ts             │  │  inatService, iapService           │
│    battle.ts            │  │  auth wrapper, storage wrapper     │
│  types.ts (canonical)   │  └───────────┬───────────────────────┘
└─────────────────────────┘              │
         ↑ also imported by              │ supabase-js / native SDKs
┌────────┴────────────────────────────────▼───────────────────────┐
│  Infra Layer  (lib/)                                            │
│  supabase.ts (singleton + auth client), capabilities.ts        │
│  polyfills.{native,web}.ts                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Supabase Edge Functions  (supabase/functions/)                 │
│  create-capture / accept-challenge / revenuecat-webhook         │
│  _shared/ imports engine/ directly                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Boundaries

### `app/` — screens only

Owns: one file per route, layout file, nothing else.
Must NOT: import from `lib/supabase.ts` directly, define types, contain logic beyond wiring props to hooks, reference `services/` directly.
Rule: every data dependency enters via a hook from `hooks/`.

### `components/` — shared UI primitives

Owns: `CaptureChip`, `StatRow`, `RarityBadge`, `LoadingSpinner`, `ErrorMessage`, and `theme.ts` (all color constants, spacing scale).
Must NOT: call hooks (except trivially memoized display state), make network calls, import from `services/` or `lib/`.
Rule: components are pure render functions. Props only. No side effects.

### `hooks/` — server state coordination

Owns: React Query queries/mutations and React Context providers. The auth state provider lives here.
Must NOT: contain JSX, import directly from `lib/supabase.ts` (goes through `services/`), reference `app/` files.
Exports: `useAuth`, `useCaptures`, `useCapture(id)`, `useBattle`, `useChallenges`, `useFriends`, `useInventory`, `useGrowth`.

### `engine/` — pure domain logic (NEW)

Owns: `rng.ts`, `stats.ts`, `battle.ts`, `types.ts`. No I/O. No imports except from within `engine/` itself.
Must NOT: import from React, Expo, Supabase, or any Node/Deno API. Zero runtime dependencies.
Rule: every function in this directory must be purely functional and deterministic. This is the only code that runs on both Metro and Deno without modification.

### `services/` — I/O boundary (NEW, replaces scattered lib calls)

Owns: one file per external system. `captureService.ts`, `challengeService.ts`, `growthService.ts`, `inatService.ts`, `iapService.ts`, `storageService.ts`, `authService.ts`.
Must NOT: contain JSX, import from `hooks/` or `app/`, import from each other except through their own dependencies on `lib/supabase.ts`.
Rule: every public function takes explicit arguments (no hidden global reads except the Supabase singleton). Every function returns a typed result or throws a typed error.

### `lib/` — infra singletons

Owns: `supabase.ts` (Supabase client singleton), `capabilities.ts` (platform feature flags), `polyfills.{native,web}.ts`.
Must NOT: contain business logic, game rules, or UI. Stays as-is structurally; `auth.ts` and `storage.ts` move up to `services/`.

### `supabase/` — Deno functions + schema

Owns: Edge Functions, `schema.sql`, `_shared/`. The `_shared/` directory imports from `engine/` via a path alias during the build step (see Section 3). Owns no TypeScript types that duplicate `engine/types.ts`.

---

## 3. Engine Sharing Strategy

**Decision: build-step copy with CI drift enforcement.**

The constraint is absolute: the engine must produce identical output on Metro (TypeScript compiled to Hermes JS) and Deno (TypeScript native). The options were:

- **(a) npm/pnpm workspace with a shared package.** Requires a monorepo root, a `package.json` for the engine package, and Deno to resolve npm specifiers. Deno supports `npm:` imports but Metro and Deno resolve packages differently enough that the build complexity is high and the failure modes are silent (version mismatch between workspace resolution and Deno's cache). Rejected: too much tooling surface for a small team.

- **(b) Symlinks.** `supabase/functions/_shared/engine` symlinked to `engine/`. Works locally. Breaks on EAS Build, Vercel, and `supabase functions deploy` in CI because symlinks are not followed uniformly across all three environments. Rejected: fragile in CI.

- **(c) Build step that copies.** A single `npm run sync-engine` script (added to `package.json`) copies `engine/*.ts` into `supabase/functions/_shared/engine/` before any deploy. CI runs `sync-engine` and then immediately diffs the copy against the source; if they diverge the build fails. The copy is committed to the repo so `supabase functions deploy` works without a build prerequisite. This is the chosen approach.

- **(d) Move engine to Supabase, client calls RPC.** Eliminates the sharing problem by making the client always call the server for simulation. Unacceptable for offline/local battle UX and adds 200-500 ms latency to every battle animation frame. Rejected.

**Chosen: option (c).** Justification: zero new tooling, works in EAS/Vercel/Supabase CI, failure is loud (diff check), and the copy is intentional and visible.

**Resulting file layout:**

```
engine/                          <- canonical, imported by Metro bundle
  rng.ts
  stats.ts
  battle.ts
  types.ts                       <- BattleStats, Element, Rarity, BattleLog, BattleResult

supabase/functions/_shared/
  engine/                        <- GENERATED — do not edit directly
    rng.ts                       <- byte-for-byte copy of engine/rng.ts
    stats.ts
    battle.ts
    types.ts
  (other _shared files remain)

scripts/
  sync-engine.ts                 <- copies engine/ → supabase/functions/_shared/engine/
  check-engine-drift.ts          <- diffs the two trees; exits non-zero if any file differs
```

`package.json` additions:

```json
"scripts": {
  "sync-engine": "ts-node scripts/sync-engine.ts",
  "predeploy:functions": "npm run sync-engine",
  "test": "jest",
  "check:engine": "ts-node scripts/check-engine-drift.ts"
}
```

CI step order: `check:engine` runs in the test job. Any PR that edits `engine/` without running `sync-engine` fails CI. The sync script is idempotent and fast (five small files).

`lib/battle.ts`, `lib/rng.ts`, and `lib/stats.ts` are deleted. All client imports repoint to `engine/`.

---

## 4. Data Access Layer

### Canonical `Capture` type

One definition lives in `engine/types.ts`. Supabase-generated types (`supabase gen types typescript --local > lib/supabase.types.ts`) are the DB source of truth; the `Capture` type in `engine/types.ts` is derived from the generated row type with a Zod validator at the service boundary.

```typescript
// engine/types.ts (excerpt)
export type Capture = {
  id: string;
  user_id: string;
  taxon_id: number;
  common_name: string;
  scientific_name: string;
  score: number;
  image_path: string;   // renamed from image_url — stores a storage path, NOT a URL
  stats: BattleStats;
  xp: number;
  age: number;
  pending_points: number;
  allocated: Partial<Record<StatKey, number>>;
  created_at: string;
};
```

### Auth-aware Supabase wrapper

All Supabase calls go through `services/`. No screen or hook calls `supabase` directly.

```typescript
// services/captureService.ts
import { supabase } from '@/lib/supabase';
import { parseCapture } from '@/engine/types';   // Zod or hand-rolled validator

export async function listCaptures(userId: string): Promise<Capture[]> {
  const { data, error } = await supabase
    .from('captures')
    .select('id, taxon_id, common_name, scientific_name, score, image_path, stats, xp, age, pending_points, allocated, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new CaptureServiceError('listCaptures', error);
  return (data ?? []).map(parseCapture);   // validator narrows unknown → Capture
}
```

### Error handling pattern

Every service function throws a typed error class. Hooks catch and expose `error: ServiceError | null`. Screens never catch errors; they render the error state from the hook.

```typescript
export class ServiceError extends Error {
  constructor(public readonly source: string, public readonly cause: unknown) {
    super(`${source}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
export class CaptureServiceError extends ServiceError {}
export class ChallengeServiceError extends ServiceError {}
export class GrowthServiceError extends ServiceError {}
```

---

## 5. State Management

**Decision: React Query for server state, a single AuthContext for identity, no Zustand.**

The app's state needs:

- **Auth identity** (user id, session): one instance, changes rarely, needed everywhere. Lives in `AuthContext` (React Context) populated at `app/_layout.tsx` via `supabase.auth.getSession()` + `onAuthStateChange`. All hooks read `userId` from context rather than calling `getUser()` per-screen.

- **Capture list, active battle, challenges, inventory**: server state that fetches on demand and invalidates on mutation. React Query handles this cleanly — stale-while-revalidate, automatic refetch on focus, mutation invalidation. No custom cache layer needed.

- **Active battle (local sim state)**: ephemeral, lives entirely in `useBattle` hook state. Not persisted, not shared across screens.

- **Friend list**: React Query, same pattern as captures.

Zustand is rejected. The app has no complex client-only global state that React Query + Context cannot handle. Adding a third state library increases the conceptual overhead for a small codebase without measurable benefit.

React Query configuration in `app/_layout.tsx`:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1 },
  },
});
```

Key query keys: `['captures', userId]`, `['challenges', userId]`, `['inventory', userId]`, `['friends', userId]`.

---

## 6. Routing and Screen Organization

Expo Router file structure for v0.2. `output` changes to `static` (see Section 7).

```
app/
  _layout.tsx          QueryClientProvider + AuthContext + initIAP + ErrorBoundary
  (auth)/
    _layout.tsx        redirect to / if already authed
    sign-in.tsx        email OTP + Apple + Google
  (app)/
    _layout.tsx        redirect to /auth/sign-in if not authed; tab navigator
    index.tsx          home hub (stats summary, quick links)
    capture.tsx        camera → iNat → Edge Fn → save
    dex.tsx            capture list
    dex/[id].tsx       single capture detail + growth actions
    battle.tsx         local 1v1 picker + client sim (decorative, logged but not authoritative)
    (social)/
      _layout.tsx
      friends.tsx      friend code entry + friend list
      challenges.tsx   challenge list (open + resolved)
      challenge/[id].tsx  challenge detail + accept flow
    shop.tsx           RevenueCat IAP
```

Route groups `(auth)` and `(app)` use Expo Router's group layout convention. The `(app)` layout handles the single auth guard — screens inside it never check auth themselves. The `(social)` sub-group isolates the v0.2 social features; they can be feature-flagged at the group layout level for a phased rollout.

---

## 7. Build and Bundle Strategy

### Switch `output: "single"` to `output: "static"`

In `app.json`:
```json
"web": {
  "bundler": "metro",
  "output": "static"
}
```

This enables per-route HTML files and per-route JS chunks. The sign-in page no longer ships the camera, IAP, and battle engine. Expected reduction: 40-60% gzipped bytes on the first-load route.

### Native-only module isolation

`app/capture.tsx` must guard `expo-camera` and `expo-location` with a `Platform.OS === 'web'` early return and dynamic `import()` on native — matching the pattern already used for `expo-apple-authentication` in `app/sign-in.tsx`. The web stub renders the "use the iOS app" message without importing any camera code.

`app/shop.tsx` must remove the `PurchasesPackage` type import. Define a local `OfferingPackage` type matching the fields actually used, so `react-native-purchases` drops from the web bundle.

### Supabase client — drop Realtime

Replace `@supabase/supabase-js` umbrella import with direct sub-package composition:

```typescript
import { createClient } from '@supabase/supabase-js';
// Switch to modular imports once @supabase/supabase-js v3 ships them stably.
// Until then: add Metro resolver alias for @supabase/realtime-js → a stub module.
```

Add to `metro.config.js`:
```javascript
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === '@supabase/realtime-js') {
    return { type: 'sourceFile', filePath: require.resolve('./lib/stubs/realtime-stub.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};
```

`lib/stubs/realtime-stub.js` exports an empty object. Realtime is not used anywhere in the codebase. Expected saving: 30-50 KB gzipped.

### Vercel cache headers

`vercel.json` additions:
```json
"headers": [
  {
    "source": "/_expo/static/(.*)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
  },
  {
    "source": "/assets/(.*)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
  },
  {
    "source": "/index.html",
    "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
  }
]
```

### Web HTML shell

Create `web/index.html` (Metro's web template path) with:
- Inline `<style>` setting `html, body, #root { background: #0b1d12; margin: 0; }`
- `<meta name="theme-color" content="#0b1d12">`
- `<link rel="preload" as="script">` for the entry chunk

This moves FCP from script-execution-bound to first-byte-bound.

---

## 8. Testing Strategy

### What must exist to ship v0.2

**Engine determinism tests** (Jest, runs in Node):

`__tests__/engine/determinism.test.ts` — imports `engine/rng`, `engine/stats`, `engine/battle` and a reproduced version of the same functions from `supabase/functions/_shared/engine/`. Runs 200 seeded pairs and asserts `winner`, `log.length`, and every log entry match exactly. This test failing means a CI block — it must gate every merge to main.

**Engine drift check** (shell, runs in CI):

`scripts/check-engine-drift.ts` diffs `engine/*.ts` against `supabase/functions/_shared/engine/*.ts` byte-for-byte and exits non-zero on any difference. Catches the case where someone edits the copy without updating the source.

**RLS policy tests** (Deno, runs against a local Supabase instance):

`supabase/tests/rls.test.ts` using `supabase-js` with `service_role` and `anon` keys against `supabase start`. Tests:
- Unauthenticated user cannot SELECT captures.
- Authenticated user can only SELECT their own captures.
- Authenticated user cannot INSERT captures directly (after the revoke is applied).
- Opponent can UPDATE challenge with own capture; cannot set `winner` or `stats`.

Run with: `supabase test db` or a Deno test runner pointed at the local instance.

**Service integration tests** (Jest + `msw` or real local Supabase):

`__tests__/services/captureService.test.ts` — mocks Supabase responses with `msw`, verifies that `listCaptures` throws `CaptureServiceError` on network failure and returns typed `Capture[]` on success. Validates that the Zod/manual validator rejects rows with missing `stats` fields.

**Frameworks:** Jest for all client-side tests (already implied by the Expo setup; add `jest-expo` preset). Deno test runner for Edge Function unit tests. No Vitest — introducing a second test runner is unnecessary complexity.

**Coverage target for v0.2 ship:** engine determinism tests (100% of public fns), RLS smoke tests (all tables), service error-path tests (all service functions). Screen-level tests are deferred to v0.3.

---

## 9. Dependency Direction Rules

These rules are enforced by reading import paths. A linter rule (`eslint-plugin-import` with `no-restricted-imports` or a custom rule) should encode them mechanically.

```
app/        may import from:  hooks/, components/, engine/types (for display types only)
            may NOT import from: services/, lib/supabase.ts directly, engine/rng|stats|battle

components/ may import from:  engine/types (for prop types), nothing else outside components/
            may NOT import from: hooks/, services/, lib/, app/

hooks/      may import from:  services/, engine/, lib/capabilities.ts
            may NOT import from: app/, components/

services/   may import from:  engine/, lib/supabase.ts, lib/capabilities.ts
            may NOT import from: hooks/, app/, components/

engine/     may import from:  nothing outside engine/
            may NOT import from: any external package, any other app directory

lib/        may import from:  nothing in app/, hooks/, services/, engine/
            (supabase.ts, capabilities.ts, polyfills are pure singletons)

supabase/functions/_shared/engine/
            is GENERATED — do not import it from the client bundle
```

---

## 10. Migration Plan from v0.1

### Step-by-step order

1. Create `engine/` directory. Move `lib/rng.ts`, `lib/stats.ts`, `lib/battle.ts` into it verbatim. Add `engine/types.ts` with `BattleStats`, `Element`, `Rarity`, `Capture`, `BattleLog`, `BattleResult`. Update internal cross-imports within `engine/`.

2. Run `sync-engine` script to populate `supabase/functions/_shared/engine/`. Delete the old `_shared/battle.ts` and `_shared/stats.ts`. Update Edge Function imports to point at `_shared/engine/`.

3. Write and pass `__tests__/engine/determinism.test.ts`. This must be green before any further migration.

4. Create `services/` directory. Move `lib/auth.ts` → `services/authService.ts`, `lib/storage.ts` → `services/storageService.ts`, `lib/inaturalist.ts` → `services/inatService.ts`, `lib/multiplayer.ts` → `services/challengeService.ts`, `lib/growth.ts` → `services/growthService.ts`. Create `services/captureService.ts` (new). Apply typed error classes throughout. Fix RPC arg names in `growthService` to match schema (`p_capture_id`, `p_stat`).

5. Create `hooks/` directory. Add `AuthContext` + `AuthProvider` to `app/_layout.tsx`. Create `useCaptures`, `useBattle`, `useChallenges`, `useInventory`, `useFriends` hooks backed by React Query. Install `@tanstack/react-query`.

6. Populate `components/`: extract `CaptureChip` (from `battle.tsx` Roster), `StatRow` (from `dex.tsx` Stat), `RarityBadge`, `LoadingSpinner`, `ErrorMessage`. Create `theme.ts` with all color constants.

7. Refactor all screens to: use hooks only (no direct Supabase calls), use components (no inline primitives), remove local `Capture` type definitions.

8. Add new screens: `app/(app)/(social)/friends.tsx`, `app/(app)/(social)/challenges.tsx`, `app/(app)/(social)/challenge/[id].tsx`, `app/(app)/dex/[id].tsx`.

9. Apply build changes: `app.json` output → `static`, `metro.config.js` Realtime stub, `vercel.json` cache headers, `web/index.html` template.

10. Apply security fixes: `revoke INSERT on captures`, fix storage path to use `captureId`, constant-time webhook secret compare, remove `_stats` from `acceptChallenge`.

### File disposition table

| Current path | v0.2 disposition |
|---|---|
| `lib/rng.ts` | Moved to `engine/rng.ts` |
| `lib/stats.ts` | Moved to `engine/stats.ts` |
| `lib/battle.ts` | Moved to `engine/battle.ts` |
| `lib/auth.ts` | Moved to `services/authService.ts` |
| `lib/storage.ts` | Moved to `services/storageService.ts` |
| `lib/inaturalist.ts` | Moved to `services/inatService.ts` |
| `lib/multiplayer.ts` | Moved to `services/challengeService.ts`; `_stats` param removed |
| `lib/growth.ts` | Split: constants → `engine/growthRules.ts`, RPCs → `services/growthService.ts`; `SHOP` dead export deleted |
| `lib/iap.ts` | Moved to `services/iapService.ts`; `initIAP` called from `_layout.tsx` |
| `lib/supabase.ts` | Stays in `lib/supabase.ts` (singleton) |
| `lib/capabilities.ts` | NEW in `lib/capabilities.ts` |
| `lib/polyfills.*.ts` | Stays in `lib/` |
| `supabase/functions/_shared/battle.ts` | Deleted — replaced by `_shared/engine/battle.ts` (generated) |
| `supabase/functions/_shared/stats.ts` | Deleted — replaced by `_shared/engine/stats.ts` (generated) |
| `components/` | Populated: `CaptureChip`, `StatRow`, `RarityBadge`, `LoadingSpinner`, `ErrorMessage`, `theme.ts` |
| `hooks/` | NEW directory with all data hooks |
| `engine/` | NEW directory — canonical game logic |
| `services/` | NEW directory — all I/O |
| `scripts/` | NEW: `sync-engine.ts`, `check-engine-drift.ts` |
| `__tests__/` | NEW: `engine/determinism.test.ts`, `services/*.test.ts` |
| `app/` | Refactored screens + new social routes |

---

## 11. Open Architecture Questions

These could not be decided without human input and block specific build tasks if left unresolved.

**1. Local battles: recorded or ephemeral?**
`app/battle.tsx` runs a local sim for immediate UX. Currently the result is not persisted anywhere. v0.2 adds async challenges that are server-authoritative. The question is whether local battle results should be written to the `battles` table at all, and if so, whether they are marked as non-authoritative or excluded from leaderboards. This affects the `battles` table schema and the `battleService` contract.

**2. `image_path` column rename migration.**
The current column is `captures.image_url`. Renaming it to `image_path` (correct per semantics) requires a DB migration that touches every existing row and every client reference. The question is whether to do this in v0.2 (clean break, small user base) or defer to v0.3 (keep backward compat). This blocks the `storageService` and `Capture` type definitions.

**3. Friends: unidirectional follow or mutual friendship?**
The `friends.tsx` screen is new in v0.2. The DB schema does not yet have a `friends` or `follows` table. The design doc mentions "friend codes" and "friend list" without specifying whether friendship is mutual (both users must accept) or unidirectional (follow). This determines the table structure, the RLS policies, and the challenge flow (can you challenge a non-friend?).

**4. Supabase schema migration strategy.**
The current `schema.sql` is a single replayable file with inline migration blocks. v0.2 adds at minimum a `friends` table, the `image_path` rename, and possibly the `battles` table INSERT policy. The question is whether to move to numbered Supabase CLI migration files now (`supabase/migrations/`) or continue with the single-file approach. Numbered migrations unlock `supabase db diff` and `supabase db reset` but require discipline to maintain. This is a team process decision that affects every schema change going forward.

**5. React Query version and Expo 52 compatibility.**
`@tanstack/react-query` v5 has a different API surface from v4. The spec assumes v5 (the current major). Expo 52 / React 18.3 compatibility should be verified against the actual installed peer deps before the hooks layer is built. If there is a known conflict, the fallback is SWR, which is smaller and has no breaking API changes in recent versions.

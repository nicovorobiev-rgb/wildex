# Wildex Code Quality Audit — v0.2
_Generated: 2026-05-21_

---

## Executive Summary

v0.2 is a substantial architectural upgrade over v0.1. The four critical v0.1 issues (engine duplication as drift risk, swallowed Supabase errors, dead `_stats` parameter, duplicate `Capture` types in screens) are all addressed to varying degrees. `engine/` is the new canonical location for game logic; `services/` enforces a typed `Result<T>` contract; `hooks/` wraps React Query; `components/` centralises UI primitives; and `lib/types.ts` acts as a compatibility shim pointing at `engine/types.ts`. The build-step copy strategy for engine sharing (sync-engine.ts + check-engine-drift.ts) is correctly wired into CI.

Despite the improvements, three categories of issues remain. First, the dependency direction rules from architecture.md §9 are violated in two places: `app/battle/[id].tsx` imports directly from `@/lib/battle` (the deleted v0.1 module — or its unconverted successor) and from `@/services/captures`, bypassing the hooks layer; and `app/friends.tsx` imports a type from `@/services/friends` rather than `@/engine/types`. Second, the old `_shared/battle.ts` and `_shared/stats.ts` still exist and have **not** been replaced by `_shared/engine/` (the generated directory is empty), meaning the Edge Functions still run the v0.1 duplicated logic that diverges from `engine/battle.ts` in a correctness-critical way: `engine/battle.ts` seeds from `(captureA.id, captureB.id, timestamp)` whereas `_shared/battle.ts` receives the seed as an external string — different seeding interface, different output for the same perceived "same" battle. Third, `sendChallenge` is called with a hardcoded empty string for `opponent_capture_id`, which will cause the Edge Function to receive an invalid capture reference on every send.

Overall the codebase is cleaner and more robust than v0.1. The testing infrastructure (engine determinism tests, service integration tests, drift CI gate) is the most significant quality improvement. The issues below are actionable and bounded.

---

## Findings

### Critical

**C1 — `_shared/engine/` is empty; Edge Functions still run the v0.1 duplicated engine**
Files: `supabase/functions/_shared/battle.ts`, `supabase/functions/_shared/stats.ts`; `supabase/functions/_shared/engine/` (directory is empty)

The architecture.md §3 and §10 migration plan specifies that `_shared/battle.ts` and `_shared/stats.ts` are deleted and replaced by a generated `_shared/engine/` populated by `sync-engine`. The `_shared/engine/` directory exists but is empty — `sync-engine` has never been run, or its output was not committed. The old files remain live and will be picked up by `supabase functions deploy`.

The consequence is a correctness divergence that is worse than v0.1:

- `engine/battle.ts:simulateBattle` takes `(captureA: BattleStats, captureB: BattleStats, timestamp: number)` and derives the seed internally via `buildSeed(captureA.id, captureB.id, timestamp)`.
- `_shared/battle.ts:simulate` takes `(a: BattleStats, b: BattleStats, seed: string)` — the seed is passed in externally. The edge function constructs the seed separately.
- `engine/battle.ts:BattleStats` includes an `id: string` field (engine/types.ts:30). `_shared/battle.ts:BattleStats` has no `id` field.

This is not just drift — it is a type incompatibility. The client-side replay screen (`app/battle/[id].tsx`) calls `simulate` from `lib/battle.ts` (not `simulateBattle` from `engine/battle.ts`), and `lib/battle.ts` also uses the old external-seed signature. For any given battle the client and server agree on outcome only because both call the same old code — but neither calls the new canonical engine. The new engine is entirely unused in any deployed path.

Fix: run `npm run sync-engine`, commit the generated `_shared/engine/`, update the Edge Functions to import from `_shared/engine/`, and delete `_shared/battle.ts` and `_shared/stats.ts`. Then update `app/battle/[id].tsx` to call `simulateBattle` from `@/engine/battle` (not `simulate` from `@/lib/battle`).

---

**C2 — `app/battle/[id].tsx` violates two dependency rules and imports a deprecated module**
File: `app/battle/[id].tsx:43,51`

```
import { getCapture, signCaptureImageUrl } from '@/services/captures';  // line 43
import { simulate } from '@/lib/battle';                                  // line 51
```

Architecture.md §9 states: `app/` must NOT import from `services/`, and `app/` must NOT import from `lib/` except for `AuthContext` and `queryClient`. Both lines violate this rule. The `lib/battle` import is also to the old unconverted module — `BattleResult` on `lib/battle.ts:9` has `winner: 'a' | 'b'` but `BattleOutcome` on `engine/battle.ts:22` has `winnerId: string`. These types are not interchangeable; a future rename will silently produce wrong winner labelling.

Fix: extract a `useBattleReplay(battleId)` hook in `hooks/useBattles.ts` that fetches both captures and runs the sim. The hook can import from `services/captures` and `engine/battle`. The screen imports only the hook.

---

**C3 — `sendChallenge` is called with `opponent_capture_id: ''` in every production send**
File: `app/challenge.tsx:324`

```typescript
opponent_capture_id: '',
```

`services/battles.ts:sendChallenge` passes `opponent_capture` to the `challenges` INSERT. The Edge Function (`accept-challenge`) subsequently reads `challenge.opponent_capture` as the opponent's capture id. With an empty string this lookup will fail or return nothing, making every accept impossible. The comment at the top of `challenge.tsx` acknowledges the spec discrepancy but describes it as a "v0.2 placeholder" — it is, in fact, a bug that makes the send→accept flow non-functional end-to-end.

Fix: either (a) align `sendChallenge`'s input type to not require `opponent_capture_id` (the spec says the opponent picks at accept time), removing the field from the INSERT, or (b) have the screen pass a real capture id. Option (a) requires updating the service and the Edge Function schema together.

---

### High

**H1 — `app/friends.tsx` imports a type from `@/services/friends` (dependency leak)**
File: `app/friends.tsx:38`

```typescript
import type { Friend, FriendRequest } from '@/services/friends';
```

Architecture.md §9: `app/` may import from `hooks/`, `components/`, and `engine/types` for display types. It must NOT import from `services/`. `Friend` and `FriendRequest` are re-exported from `engine/types.ts` (confirmed in services/friends.ts:46). The import should be:

```typescript
import type { Friend, FriendRequest } from '@/engine/types';
```

---

**H2 — `BattleInput` type alias is a silent lie — `simulateBattle` accesses `.id` but the type does not declare it**
File: `engine/battle.ts:19,116-117`

```typescript
export type BattleInput = BattleStats;   // line 19 — alias

export function simulateBattle(
  captureA: BattleStats,                 // line 116
  captureB: BattleStats,                 // line 117
  ...
```

Inside `simulateBattle`, `captureA.id` (line 120) and `captureB.id` (lines 151, 153, 155, 157, 159) are accessed. Because `engine/types.ts:BattleStats` includes `id: string` (line 30), TypeScript accepts this, but it is structurally confusing: `BattleStats` is named for stats, not for captures-with-ids.

The architecture spec defines `CaptureForBattle` as `{ id: string } & BattleStats` (engine/types.ts:132) precisely for this purpose. `simulateBattle`'s parameters should be typed `CaptureForBattle`, not `BattleStats`, and `BattleInput` should alias `CaptureForBattle`. The test fixtures already set an `id` field on every `BattleInput` (battle.test.ts:34-53) so the tests are already using the right shape. The function signature just needs to reflect it.

---

**H3 — `hooks/useProfile.ts` imports `supabase` directly from `lib/supabase` (dependency rule violation)**
File: `hooks/useProfile.ts:18`

```typescript
import { supabase } from '@/lib/supabase';
```

Architecture.md §9: `hooks/` must NOT import directly from `lib/supabase.ts`. The profile update call in `useUpdateProfile` should go through a service function (e.g. `services/captureService` or a new `services/profileService`). The comment in `hooks/useCaptures.ts:195-196` acknowledges the same issue for the storage upload helper and at least justifies it explicitly; `useProfile.ts` has no such justification.

Note: `hooks/useCaptures.ts:19` also imports `supabase` directly, justified in the comment at line 194-196. That comment is honest but should be resolved — extract an `uploadCapture` service function.

---

**H4 — `'use client'` directive on a React Native hook file**
File: `hooks/useProfile.ts:1`

```typescript
'use client';
```

This is a Next.js App Router directive. The codebase is Expo Router (React Native). The directive is meaningless in this context but creates confusion and signals that the file was authored with a different framework in mind. All other hook files lack it. Remove.

---

**H5 — `check:engine` is not wired into `pretest` — a contributor can break the drift gate**
File: `package.json:13-14`

`check:engine` runs in the `.github/workflows/test.yml` CI job (confirmed at line 53 of that file) but is not listed in `package.json`'s `test` script. Running `npm test` locally does not run `check:engine`. A developer who edits `engine/` without syncing can push, pass `npm test` locally, and only fail in CI. Architecture.md §8 specifies the drift check must gate every merge.

Fix: add `"pretest": "npm run check:engine"` to `package.json` so local `npm test` always validates sync.

---

### Medium

**M1 — `lib/battle.ts`, `lib/rng.ts`, `lib/stats.ts` — old engine still lives in `lib/` with no deletion**

Architecture.md §10 step 1 specifies these files are moved to `engine/`. They were copied (not moved): all three still exist in `lib/`. `lib/stats.ts` imports `IdSuggestion` from `lib/inaturalist`, uses the old `rollStats(captureId, top: IdSuggestion)` signature, and has an entirely different `BattleStats` type without `id`. `lib/rng.ts` is byte-identical to `engine/rng.ts` (harmless, but redundant). `lib/battle.ts` uses `simulate()` with an external seed string, diverging from `engine/battle.ts`'s `simulateBattle()` with internal seed derivation.

These files are actively imported (`app/battle/[id].tsx:51`, `lib/stats.ts` by `lib/battle.ts:5`) and not merely dead. Deleting them would require the screen refactor described in C2 above.

---

**M2 — `OutgoingRow` in `app/challenge.tsx` assumes `winner === 'a'` means the challenger won**
File: `app/challenge.tsx:288`

```typescript
{challenge.winner === 'a' ? 'You won' : 'You lost'}
```

`winner: 'a' | 'b'` in `engine/types.ts` means `'a' = challenger won, 'b' = opponent won` (confirmed by Challenge type comment at line 176). The outgoing row renders for the challenger. So `winner === 'a'` does correctly mean the challenger (the current user in the outgoing section) won. However the IncomingRow at line 197 shows:

```typescript
const winner = result.winner === 'a' ? 'challenger' : 'you';
Alert.alert('Battle resolved', `Winner: ${winner}`);
```

This is also correct: the incoming user is 'b', so `winner === 'b'` means 'you'. Both sides are consistent, but the inconsistency in display strings ("challenger" vs user's display name) is a UX gap that will confuse users. This is a medium severity UX issue.

---

**M3 — `_shared/stats.ts` uses the old `rollStats(captureId, top: IdSuggestion)` signature; `engine/stats.ts` uses the new flat signature**

`_shared/stats.ts:55`: `rollStats(captureId: string, top: IdSuggestion)`
`engine/stats.ts:93`: `rollStats(captureId, taxonId, iconicTaxon, score)`

The Edge Functions that call `_shared/stats.ts` pass an `IdSuggestion` object. When `_shared/engine/` is eventually populated and the Edge Function imports change, the call sites will break with a type error. Since `_shared/engine/` is currently empty this is not yet a runtime problem, but it must be addressed before the migration is completed.

---

**M4 — `Result<T>` shape is inconsistent across services**

`services/captures.ts` defines `Result<T>` as `{ ok: true; data: T } | { ok: false; error: Error }` (line 17-19).
`services/battles.ts` defines `Result<T>` as `{ ok: true; value: T } | { ok: false; error: BattleServiceError }` (lines 22-23) — `value` not `data`.
`services/friends.ts` defines `Result<T>` as `{ ok: true; data: T } | { ok: false; error: FriendsServiceError }` (lines 17-19).

Two of three services use `.data` but `battles.ts` uses `.value`. The corresponding `unwrap` helper in `hooks/useCaptures.ts` (line 50) destructures `{ ok: true; data: T }`, while `hooks/useBattles.ts:46` destructures `{ ok: true; value: T }`. This means a caller that mistakenly imports the wrong hook type will get undefined silently. Standardise to a single `Result<T>` definition in a shared location (e.g. `engine/types.ts` or a new `lib/result.ts`) and re-export it from all services.

---

**M5 — `services/battles.ts:sendChallenge` does not wrap in a try/catch — it can throw**
File: `services/battles.ts:89-101`

```typescript
export async function sendChallenge(...): Promise<Result<...>> {
  const { data, error } = await supabase
    .from('challenges')
    ...
  if (error) return err('sendChallenge', error);
  return ok(...);
}
```

Every other public function in `services/captures.ts` wraps its body in `try/catch` and returns `{ ok: false }` on unexpected throws. `sendChallenge` does not — a network timeout or unexpected Supabase client throw will propagate uncaught to the React Query mutation, which will then catch it as a generic error without the typed `BattleServiceError` wrapper. Apply the same try/catch pattern used in `captures.ts`.

---

**M6 — `useReplay` hook in `app/battle/[id].tsx` does not reset state when `log` changes**
File: `app/battle/[id].tsx:126-157`

The `useEffect` inside `useReplay` depends on `[enabled, log, maxHpA, maxHpB]`. If `log` or `maxHpA` changes (e.g., the parent re-fetches), the effect re-runs but `visibleTurns`, `currentHpA`, `currentHpB`, `attackerSide`, and `phase` are NOT reset. The interval starts a new replay animation while the old state (partially-accumulated `visibleTurns`) still shows. Add explicit state resets at the start of the effect before setting `phase('playing')`.

---

**M7 — `useProfile.ts:refetch` creates a new function on every render**
File: `hooks/useProfile.ts:57-60`

```typescript
const refetch = async (): Promise<void> => {
  await supabase.auth.getSession();
};
return { profile, isLoading, refetch };
```

`refetch` is declared inside `useProfile()` without `useCallback`. Every consumer that takes `refetch` as a prop or dependency will see a new reference on every render. Wrap with `useCallback(async () => { await supabase.auth.getSession(); }, [])`.

---

### Low

**L1 — `lib/types.ts` shim is `@deprecated` but has no removal plan or tracking issue**
File: `lib/types.ts:11-13`

The shim is documented as deprecated with a `TODO(post-v0.2)` comment. No screens have been updated to import directly from `@/engine/types`. Until they are, refactoring engine types requires updating both files. A single-pass `sed` migration would take minutes; leaving it indefinitely invites confusion.

---

**L2 — `app/index.tsx` makes two redundant `useCaptures()` calls**
File: `app/index.tsx:120-121`

```typescript
const { data: allCaptures, isLoading: capturesLoading } = useCaptures();
const { data: recentCaptures } = useCaptures({ limit: RECENT_LIMIT });
```

React Query deduplicates requests with the same key. But `useCaptures()` and `useCaptures({ limit: 5 })` produce different query keys (`['captures', userId, {}]` vs `['captures', userId, { limit: 5 }]`), so two separate network requests are made. The full list is fetched and then the recent five are fetched again separately. Call `useCaptures()` once and derive `recentCaptures` as `allCaptures?.slice(0, RECENT_LIMIT) ?? []`.

---

**L3 — `IncomingRow` in `app/challenge.tsx` instantiates `useAcceptChallenge()` inside a list render**
File: `app/challenge.tsx:188`

```typescript
function IncomingRow({ ... }) {
  ...
  const accept = useAcceptChallenge();
```

`IncomingRow` is rendered inside `.map()` in `ChallengeScreen`. Each list item creates its own mutation instance. This is valid under React's Rules of Hooks (the component is stable, not inline), but it means N pending mutation states coexist when the list has N items, and React Query cache entries are not shared between them. Lift `useAcceptChallenge()` to `ChallengeScreen` and pass `mutate` + `isPending` as props.

---

**L4 — `app/challenge.tsx` uses `TouchableOpacity` for `OutgoingRow` but `Pressable` everywhere else**
File: `app/challenge.tsx:274`

```typescript
<TouchableOpacity ...>
```

All other interactive elements in the screens use `Pressable`. `TouchableOpacity` is the legacy API. Standardise on `Pressable` throughout.

---

**L5 — `app/dex.tsx` routes to `/capture/[id]` but the route is not declared in `app/_layout.tsx`**
File: `app/dex.tsx:221`

```typescript
router.push({ pathname: '/capture/[id]', params: { id: capture.id } });
```

`app/_layout.tsx` registers `capture` as a full-screen route (`name="capture"`) but does not register `capture/[id]`. Architecture.md §6 lists `dex/[id].tsx` for the single capture detail screen — not `capture/[id].tsx`. This navigation will produce a 404-equivalent "Route not found" error at runtime.

---

**L6 — `app/battle/[id].tsx` has no `accessibilityLabel` on the BattleSlot components**
File: `app/battle/[id].tsx:304-321`

`BattleSlot` receives no `accessibilityLabel` prop; screen reader users cannot identify which slot is the opponent and which is the player. Add `accessibilityLabel` conveying capture name and current HP.

---

**L7 — `engine/stats.ts:rollStats` comment says `taxonId` is "not used in the stat formula; reserved for future element overrides" but the test suite asserts this**
File: `engine/stats.ts:98-101`, `engine/__tests__/stats.test.ts:230-234`

```typescript
// taxonId is part of the public contract and reserved for future use.
void taxonId;
```

The test at `stats.test.ts:230` asserts `taxonId` does not affect output. This is correct and intentional. However the parameter appears in the public signature and any future caller might assume it has an effect. The `void taxonId` suppressor is correct but a JSDoc `@param` note that says "currently unused — do not rely on this for stat calculation" would prevent confusion.

---

**L8 — `engine/battle.ts:BattleInput` and `engine/types.ts:CaptureForBattle` are redundant aliases for the same shape**

`engine/battle.ts:19`: `export type BattleInput = BattleStats;`
`engine/types.ts:132`: `export type CaptureForBattle = { id: string } & BattleStats;`

`BattleInput` is defined as `BattleStats` (which already has `id` in v0.2). `CaptureForBattle` is the explicitly documented type for the same purpose. Consolidate: remove `BattleInput`, use `CaptureForBattle` in the `simulateBattle` signature and in the test fixtures.

---

**L9 — `services/friends.ts:removeFriend` silently ignores the second delete error**
File: `services/friends.ts:260-265`

```typescript
await supabase
  .from('friendships')
  .delete()
  .eq('user_id', friend_user_id)
  .eq('friend_id', userId);
// Silently ignore errors on the reverse delete — the caller's side is gone.
```

The comment is honest about the intent, but the silence is undiscoverable from outside the function. A `console.warn` with a structured message would at minimum surface the partial delete in logs without changing semantics.

---

## What Is Done Well

**Engine architecture is well-executed.** `engine/types.ts` is a genuine single source of truth. The `rollStats` signature refactoring (flat args instead of `IdSuggestion` object) is cleaner and makes the pure-function contract explicit. `BattleStats.id` being part of the stats type is an intentional design choice documented with a comment.

**Test suite is the standout improvement.** The engine determinism tests (battle.test.ts, rng.test.ts, stats.test.ts) are thorough. The "pinned ground-truth" approach — committing exact expected values and treating any change as a forced intentional update — is the right pattern for a deterministic engine. Service integration tests with the mock-supabase fixture are correctly isolated.

**React Query integration is clean.** Query key design is consistent (`['captures', userId, opts]`, `['challenges', userId, filter]`, etc.), invalidation is correct in all mutation `onSuccess` handlers, and the `unwrap` helper pattern is idiomatic. `useBattleHistory` is properly gated behind `enabled: user !== null`.

**Service layer `Result<T>` pattern is almost fully consistent.** Captures and friends services never throw; all error paths return typed results. The `toError` helper in `captures.ts` is simple and correct.

**`AuthContext` is correctly implemented.** The `fetchProfile` function is memoized with `useCallback`. The cancellation flag `cancelled` in the `resolveSession` `useEffect` prevents state updates on unmounted components. The `onAuthStateChange` subscription is properly unsubscribed in the cleanup function. `isLoading` is set to `false` after both the initial session check and the first auth state change, avoiding a race.

**`check-engine-drift.ts` is rigorous.** The orphan-detection pass (files in `_shared/engine/` with no matching source) prevents accidental stale files. The autogenerated-header stripping before hash comparison handles the sync script's header injection cleanly.

**`dex.tsx` screen is the most complete v0.2 screen.** It has a loading state, an error-aware FlatList, refresh control, filter/sort memoization with `useMemo`, proper `FlatList` `keyExtractor`, and accessibility roles on all interactive filter chips.

---

## Recommended Next Steps

1. **Run `sync-engine` and commit the generated files; delete `_shared/battle.ts` and `_shared/stats.ts` (Critical C1).** This is a one-command fix (`npm run sync-engine`) followed by updating the Edge Function imports to `_shared/engine/`. The `check:engine` CI gate will then actually protect the shared tree. Until this is done the new engine is entirely bypassed at runtime.

2. **Fix the `opponent_capture_id: ''` hardcoded empty string in `app/challenge.tsx:324` (Critical C3).** The cleanest fix is to remove `opponent_capture_id` from `SendChallengeInput` (since the spec says the opponent picks at accept time), drop it from the INSERT in `services/battles.ts`, and update the Edge Function to not read it from the challenge row at send time.

3. **Extract `useBattleReplay` hook and resolve `app/battle/[id].tsx` dependency violations (Critical C2).** Move the `getCapture`, `signCaptureImageUrl`, and `simulate` calls into a hook in `hooks/useBattles.ts`. Replace the `lib/battle` import with `engine/battle`. This eliminates both rule violations and sets up the screen to use `simulateBattle` (the new canonical function) once `_shared/engine/` is live.

4. **Standardise `Result<T>` across services (Medium M4).** Extract a single `Result<T>` type to `lib/result.ts` and re-export it from all three services. Rename `battles.ts:Ok.value` to `Ok.data` to match the other two. The unwrap helpers in the hooks will need a one-line update.

5. **Fix `app/dex.tsx:221` route to `/capture/[id]` → `/dex/[id]` (Low L5).** This is a dead navigation path. Architecture.md §6 specifies `dex/[id].tsx` as the single capture detail route. Add `app/dex/[id].tsx` and register it in `_layout.tsx`, or correct the push target to whatever route is implemented.

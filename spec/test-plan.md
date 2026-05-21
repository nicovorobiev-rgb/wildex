# Wildex v0.2 — Test Plan

_Pairs with `spec/SPEC.md`. Every v0.2 feature in SPEC §2 maps to at least one test case here._
_Audits being closed: `AUDIT-CODE.md`, `AUDIT-SECURITY.md`, `AUDIT-PERFORMANCE.md`, `AUDIT-ARCHITECTURE.md` (all 2026-05-20)._

---

## 1. Test Framework Choice

**Jest for the Expo / React Native client, Deno's built-in test runner for Edge Functions, plus one cross-runtime parity test.**

Rationale:
- **Jest** is the supported test runner for Expo + RN — `jest-expo` preset already handles the Metro module map, `react-native` mocks, and `Platform.OS` so unit and component tests run without per-platform shims. Vitest is faster but has known friction with RN's transform pipeline and doesn't match the official Expo testing path documented for SDK 52.
- **Deno test** runs the Edge Functions in their actual runtime. The `_shared/` modules (battle engine, stats) are Deno-native and cannot be tested under Jest without rewriting their imports. Edge Function tests run via `deno test --allow-net --allow-env` against a local Supabase stack (`supabase start`).
- **Parity test** is a single Deno script that imports the `_shared/` versions, fetches the `lib/` versions over the file system (read as text + evaluated in a sandbox), and asserts byte-equal output across 100 seeded inputs. This closes AUDIT-CODE High "engine duplication" without requiring a full refactor in v0.2.
- **E2E**: **Maestro** for the Expo iOS dev client (declarative YAML flows, works with Expo Go and dev clients, no Detox build complexity for a v0.2 surface), and **Playwright** for the web build (Vercel preview URLs). Both are cheap to wire and don't require us to commit to Detox at this scale.

We do **not** add Vitest. Two test runners is enough; three is taxonomy debt.

---

## 2. Test Categories

### 2.1 Unit — Engine determinism (Jest + Deno)
**Covers:** `lib/rng.ts`, `lib/stats.ts`, `lib/battle.ts` and their `_shared/` siblings.
**Framework:** Jest for `lib/`, Deno test for `_shared/`.
**Coverage target:** **100% lines + branches.** This is the integrity-critical core; no excuses.

Example test cases:
- **D1** — `simulate({captureA, captureB, seed: 'fixed-seed'})` returns the same `winner` and the same `log.length` and the same `log[].damage` for 10 fixed input triples across 1000 runs.
- **D2** — `rollStats('cap-001', { taxonId: 12345, iconicTaxon: 'Mammalia', score: 0.78 })` returns the same `BattleStats` object on every call.
- **D3** — `rng('cap-001:cap-002:1700000000000')` returns a numerically identical sequence (first 20 values) between `lib/rng.ts` and `_shared/` versions.
- **D4** — Changing a single byte of the input seed produces a different first PRNG value (sanity check the seed is actually consumed).
- **D5** — `simulate()` terminates within `MAX_TURNS` (200) for 10,000 random seeded inputs (no infinite loops).

### 2.2 Unit — Stats and mappings (Jest)
**Covers:** `ELEMENT_MAP`, `RARITY_BUDGET`, `ELEMENT_BIAS`, `TYPE_CHART`.
**Framework:** Jest.

Example test cases:
- **S1** — Every `iconicTaxon` documented in DESIGN.md maps to a known `Element`; unmapped strings fall back to `unknown`.
- **S2** — `RARITY_BUDGET` is monotonic: a `score` of 0.95 produces ≥ the stat budget of a `score` of 0.50.
- **S3** — `TYPE_CHART` is internally consistent: every (attacker, defender) pair has a defined multiplier in `[1.0, 1.4]`.
- **S4** — Known-vector test: `(captureId='legend-test', taxonId=1, score=0.99, iconicTaxon='Aves')` produces the exact stat block committed in `__tests__/__fixtures__/known-stats.json`.

### 2.3 Integration — Supabase RLS + Edge Functions (Deno + Jest)
**Covers:** Schema policies, Edge Function happy paths and auth failures, server-rolled stats, capture INSERT lockdown.
**Framework:** Deno test against `supabase start` local stack for Edge Functions; Jest with `@supabase/supabase-js` against the same stack for RLS.

Example test cases:
- **I1** — User A signed in cannot SELECT capture rows belonging to User B (`.eq('user_id', userB.id)` returns 0 rows, not 403 — RLS filter behavior).
- **I2** — User A signed in cannot INSERT into `captures` directly (`from('captures').insert(...)` returns permission-denied after `revoke insert on captures` is applied). **Closes AUDIT-SECURITY Critical 1.**
- **I3** — `create-capture` rejects a request with no `Authorization` header (401).
- **I4** — `create-capture` rejects a `storage_path` that does not start with `${user.id}/` (403).
- **I5** — `create-capture` rejects a payload missing `exif_datetime` (400 `EXIF_MISSING`).
- **I6** — `create-capture` rejects a payload with `exif_datetime` more than 5 min in the past (400 `EXIF_STALE`).
- **I7** — `create-capture` accepts a fresh EXIF and persists a `captures` row with server-rolled stats; the persisted `stats` exactly equals `rollStats(serverCaptureId, suggestion)`.
- **I8** — `create-capture` ignores any `stats` field in the client body (test: send `{stats: {hp:9999,...}}`; assert persisted stats != 9999).
- **I9** — `accept-challenge` rejects a request from a user who is not the addressed `opponent_id` (403).
- **I10** — `accept-challenge` reads both captures' stats from the DB (test: mutate one capture's stats in DB between request and resolution; assert the resolved battle used the post-mutation stats, never any client-supplied stats).
- **I11** — `accept-challenge` is idempotent: a second call with the same `challenge_id` returns the existing result (409) and does not re-run `simulate()`.
- **I12** — `protect_challenge_resolution` trigger blocks a direct client UPDATE to `winner` or `result_log` (audit defense-in-depth).
- **I13** — Storage RLS: a user signed in as A cannot GET a signed URL for an object under `${userB.id}/...` (Storage returns 404/403). **Verifies AUDIT-SECURITY Critical 2 once the bucket is private.**
- **I14** — Storage bucket privacy assertion: a CI step runs `select public from storage.buckets where id='captures'` and fails the build if `public = true`.
- **I15** — Friend codes: User A generates a code, User B adds it; both can list each other in `/friends`; User C cannot see either of them.
- **I16** — iNat token validation: when `EXPO_PUBLIC_INAT_TOKEN` is set, `identifyAnimal` includes the `Authorization: Bearer ...` header (mocked fetch).

### 2.4 E2E — Key flows (Maestro + Playwright)
**Covers:** The full v0.2 loop, end-to-end, against a real Supabase project (preview env) and a real iNat token.
**Framework:** Maestro (iOS dev client) + Playwright (web build).

Example test cases:
- **E1** — **Email sign-in → home.** Maestro: launch app, tap Email, enter test address, tap Send, open mail (using a real catch-all test inbox like Mailosaur), tap link, land on `/`.
- **E2** — **Capture → identify → save → dex.** Maestro: from `/`, tap Capture, simulate camera with fixture image, select top suggestion, confirm; assert the new capture appears in `/dex` within 5 s.
- **E3** — **Friend code add.** Maestro on two devices (or two simulator instances): A generates code; B enters code; both screens show the friendship within 3 s.
- **E4** — **Send and resolve a challenge.** Same two-instance setup: A sends a challenge; B sees it pending; B accepts with their own capture; both see the same `winner` value within 5 s.
- **E5** — **Web sign-in + dex view.** Playwright: visit Vercel preview, sign in with Google (test account), navigate to `/dex`, assert at least one capture renders with a signed image URL.

---

## 3. Critical Test Cases (the must-haves)

If all of the following pass, the audit findings dated 2026-05-20 are objectively closed for v0.2. Total: **22 test cases.**

| # | ID | Description | Closes |
|---|----|-------------|--------|
| 1 | I2 | Client INSERT on `captures` is denied after `revoke insert` | AUDIT-SECURITY Critical 1 |
| 2 | I14 | CI assertion fails if `captures` bucket becomes public | AUDIT-SECURITY Critical 2 |
| 3 | I13 | Storage RLS blocks cross-user object reads | AUDIT-SECURITY Critical 2 |
| 4 | I8 | `create-capture` ignores client-supplied stats | AUDIT-SECURITY High (client-claimed stats) |
| 5 | I10 | `accept-challenge` always reads stats from DB | AUDIT-SECURITY High (challenge stat leak) |
| 6 | I11 | `accept-challenge` is idempotent | Server-authority correctness |
| 7 | I12 | `protect_challenge_resolution` trigger blocks bad UPDATEs | AUDIT-SECURITY High defense-in-depth |
| 8 | I9 | Non-addressed user cannot accept challenge | AUDIT-SECURITY |
| 9 | I5 | EXIF missing → 400 `EXIF_MISSING` | SPEC 2.5 |
| 10 | I6 | EXIF stale → 400 `EXIF_STALE` | SPEC 2.5 |
| 11 | I7 | Fresh EXIF + valid payload persists server-rolled stats | SPEC 2.4 / 2.6 |
| 12 | D1 | `simulate()` deterministic across 1000 runs | SPEC 2.10 / replay verification |
| 13 | D3 | `rng()` byte-equal between `lib/` and `_shared/` | AUDIT-CODE High (engine duplication) |
| 14 | S4 | Known-vector stat roll matches committed fixture | SPEC 2.6 |
| 15 | I1 | RLS blocks cross-user capture SELECT | SPEC 2.7 |
| 16 | I15 | Friend codes round-trip cleanly | SPEC 2.8 |
| 17 | I16 | iNat token is sent when env var is set | SPEC 2.11 |
| 18 | E1 | Email sign-in → home end-to-end | SPEC 2.1 |
| 19 | E2 | Capture → dex end-to-end | SPEC 2.4 |
| 20 | E4 | Send + resolve challenge end-to-end | SPEC 2.9 / 2.10 |
| 21 | E5 | Web sign-in + dex render | SPEC 2.3 / 2.7 |
| 22 | I3 | `create-capture` rejects unauthenticated requests | AUDIT-SECURITY baseline |

Plus the supporting determinism / mapping suite (D2, D4, D5, S1, S2, S3) which are not on the critical-22 list but are required for unit coverage.

---

## 4. CI Strategy

**Where tests run:** GitHub Actions (one workflow file: `.github/workflows/ci.yml`).

**Job graph:**

1. **lint-and-typecheck** — `tsc --noEmit` on the Expo project. Blocks PR merge on failure.
2. **unit-jest** — `jest` (parallel by file). Includes unit-engine + unit-stats categories. Blocks merge.
3. **unit-deno** — `deno test supabase/functions/_shared/**/*.test.ts`. Blocks merge.
4. **parity** — Single Deno script asserting `lib/` and `_shared/` engine output is byte-equal. Blocks merge. **This is the AUDIT-CODE High mitigation.**
5. **integration** — Spins up `supabase start` in the runner, applies `schema.sql`, deploys the three Edge Functions locally, runs the I-series tests. Blocks merge.
6. **bucket-privacy-check** — Runs against the actual staging Supabase project (read-only): SQL query asserting `captures` bucket is `public = false`. Blocks deploy (NOT merge — preview deploys still go up).
7. **build-web** — `npm run build:web`, then `vercel deploy --prebuilt` to a preview URL. Blocks merge if build fails.
8. **e2e-web** — Playwright against the preview URL. **Required** on PRs touching `app/*.tsx` or `lib/*.ts`; optional otherwise (label-gated `run-e2e`).
9. **e2e-ios** — Maestro on an EAS-built dev client. **Nightly**, not per-PR (build time is too high to gate every commit). Blocks the release tag.

**Merge gates (must all pass to merge to `main`):**
- lint-and-typecheck, unit-jest, unit-deno, parity, integration, build-web.

**Deploy gates (`main` → production):**
- All merge gates + bucket-privacy-check + e2e-web + the latest nightly e2e-ios green.

**Local dev:**
- `npm test` runs Jest unit + integration (assumes `supabase start` is already running).
- `deno test supabase/functions/` runs Deno tests.
- `npx maestro test .maestro/` runs the local Maestro flows against a connected simulator.

---

## 5. Coverage Targets

| Surface | Target | Enforcement |
|---|---|---|
| `lib/rng.ts`, `lib/stats.ts`, `lib/battle.ts` | **100% lines, 100% branches** | Jest `--coverage` with per-file thresholds in `jest.config.js`. CI fails below threshold. |
| `supabase/functions/_shared/*` | **100% lines, 100% branches** | Deno coverage (`deno test --coverage`). CI fails below threshold. |
| `supabase/functions/*/index.ts` (each Edge Function) | 80% lines | Deno coverage. |
| `lib/auth.ts`, `lib/multiplayer.ts`, `lib/storage.ts`, `lib/growth.ts` | 70% lines | Jest coverage. |
| `app/*.tsx` (screens) | 50% lines (smoke-level) | Jest coverage with `jest-expo` + `@testing-library/react-native`. Screens are covered primarily by E2E, not unit. |

**Explicit promise:** the deterministic engine (`rng` + `stats` + `battle` + their `_shared/` siblings) is held to **100% line and branch coverage**, no exemptions. Anything less and the parity test loses meaning because uncovered branches can silently drift.

**Explicit non-promise:** v0.2 does NOT promise visual regression testing, accessibility automation, performance budgets in CI, or load tests on the Edge Functions. Those land in v0.3 or later.

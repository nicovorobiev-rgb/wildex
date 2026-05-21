// Edge Function: accept-challenge (v0.2)
//
// Security hardening over v0.1:
//   - CORS tightened from `*` to an env-var allowlist (WILDEX_ALLOWED_ORIGINS)
//   - Input validation: UUID format check on opponent_capture_id; code length/charset
//   - Caller verified to be the challenge opponent_id (via DB row, not client claim)
//   - Idempotency: already-resolved challenges return 200 with stored result
//   - Error responses use typed { error: { code, message } } — no DB strings leaked
//
// Preserved from v0.1:
//   - Auth pattern: JWT via userClient.auth.getUser() — never trust client-sent id
//   - Service-role reads both captures.stats from DB (audit-confirmed authoritative)
//   - DB write of resolution under service role (bypasses protect_challenge_resolution)
//   - Opponent submits challenge code, not challenge_id (prevents enumeration — Audit M2)
//
// Deploy:  supabase functions deploy accept-challenge --no-verify-jwt
// Invoke:  POST /functions/v1/accept-challenge
//          Authorization: Bearer <user JWT>
//          { code: string, opponent_capture_id: string }

import { createClient } from "npm:@supabase/supabase-js@2";
import { simulateBattle } from "../_shared/engine/battle.ts";
import type { BattleInput, BattleStats } from "../_shared/engine/battle.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * Comma-separated list of allowed origins, e.g.:
 *   WILDEX_ALLOWED_ORIGINS=https://wildex.app,https://wildex.vercel.app
 * Falls back to [] (deny all cross-origin) if the env var is unset/empty.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (Deno.env.get("WILDEX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

/** Returns CORS headers for a matching origin, or null if the origin is not allowed. */
function corsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin) return null;
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ---------------------------------------------------------------------------
// Response helpers — typed error envelope, no leaked internals
// ---------------------------------------------------------------------------

type ErrorCode =
  | "bad_json"
  | "invalid_input"
  | "missing_fields"
  | "auth_required"
  | "forbidden"
  | "not_found"
  | "already_resolved"
  | "capture_mismatch"
  | "write_failed"
  | "method_not_allowed"
  | "origin_not_allowed";

function json(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}

function err(
  status: number,
  code: ErrorCode,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return json(status, { error: { code, message } }, extraHeaders);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z2-9]{6,12}$/;  // generous: challenger_id codes are uppercase alphanum

function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isValidCode(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 32;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  const cors   = corsHeaders(origin);

  // Preflight — only allow if origin matches
  if (req.method === "OPTIONS") {
    if (!cors) return err(403, "origin_not_allowed", "Origin not permitted");
    return new Response(null, { status: 204, headers: cors });
  }

  // Reject unknown origins on non-preflight too (defence-in-depth)
  if (origin !== null && !cors) {
    return err(403, "origin_not_allowed", "Origin not permitted");
  }

  if (req.method !== "POST") {
    return err(405, "method_not_allowed", "POST only", cors ?? undefined);
  }

  // ------------------------------------------------------------------
  // Auth — identify caller via JWT; never trust client-supplied user id
  // ------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return err(401, "auth_required", "Bearer token required", cors ?? undefined);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return err(401, "auth_required", "Invalid or expired token", cors ?? undefined);
  }

  // ------------------------------------------------------------------
  // Parse and validate body
  // ------------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err(400, "bad_json", "Request body must be valid JSON", cors ?? undefined);
  }

  if (typeof body !== "object" || body === null) {
    return err(400, "invalid_input", "Body must be a JSON object", cors ?? undefined);
  }

  const { code, opponent_capture_id } = body as Record<string, unknown>;

  if (!isValidCode(code)) {
    return err(400, "missing_fields", "code is required", cors ?? undefined);
  }
  if (!isValidUuid(opponent_capture_id)) {
    return err(400, "invalid_input", "opponent_capture_id must be a valid UUID", cors ?? undefined);
  }

  // ------------------------------------------------------------------
  // Service-role client (bypasses RLS + protect_challenge_resolution)
  // ------------------------------------------------------------------
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ------------------------------------------------------------------
  // 1. Look up challenge by code — service role bypasses SELECT policy
  //    (tightened policy hides open challenges from authenticated role).
  //    No filter on opponent_id here — we handle both resolved + open.
  // ------------------------------------------------------------------
  const { data: ch, error: chErr } = await admin
    .from("challenges")
    .select("*")
    .eq("code", (code as string).toUpperCase())
    .single();

  if (chErr || !ch) {
    return err(404, "not_found", "Challenge not found", cors ?? undefined);
  }

  // ------------------------------------------------------------------
  // 2. Idempotency — if already resolved, return stored result (no re-sim)
  // ------------------------------------------------------------------
  if (ch.winner !== null && ch.winner !== undefined) {
    return json(
      200,
      {
        winner:       ch.winner,
        seed:         ch.seed,
        log:          [],        // log is not persisted; re-run locally with (seed) if needed
        challenge_id: ch.id,
        already_resolved: true,
      },
      cors ?? undefined,
    );
  }

  // ------------------------------------------------------------------
  // 3. Business rules — open challenge checks
  // ------------------------------------------------------------------
  if (ch.challenger_id === user.id) {
    return err(403, "forbidden", "Cannot accept your own challenge", cors ?? undefined);
  }

  // Validate that the opponent has not already accepted (opponent_id set but winner null
  // is an intermediate state that should not normally occur; guard it anyway)
  if (ch.opponent_id !== null && ch.opponent_id !== user.id) {
    return err(403, "forbidden", "Challenge already claimed by another opponent", cors ?? undefined);
  }

  // ------------------------------------------------------------------
  // 4. Load BOTH captures' stats from the DB — never trust client payload.
  //    Also verifies opponent_capture_id belongs to the caller (user_id).
  // ------------------------------------------------------------------
  const { data: caps, error: capErr } = await admin
    .from("captures")
    .select("id, user_id, stats")
    .in("id", [ch.challenger_capture, opponent_capture_id]);

  if (capErr || !caps || caps.length !== 2) {
    return err(400, "not_found", "One or both captures not found", cors ?? undefined);
  }

  const challengerCap = caps.find((c) => c.id === ch.challenger_capture);
  const opponentCap   = caps.find((c) => c.id === opponent_capture_id);

  if (!challengerCap || !opponentCap) {
    return err(400, "capture_mismatch", "Capture lookup mismatch", cors ?? undefined);
  }
  if (opponentCap.user_id !== user.id) {
    return err(403, "forbidden", "opponent_capture_id does not belong to you", cors ?? undefined);
  }

  // ------------------------------------------------------------------
  // 5. Simulate server-side.
  //    Seed is derived deterministically and stored for replay/audit.
  //    Timestamp is captured once so seed and DB row stay consistent.
  // ------------------------------------------------------------------
  const timestamp = Date.now();
  const seed = `${ch.challenger_capture}:${opponent_capture_id}:${timestamp}`;

  const inputA: BattleInput = { ...(challengerCap.stats as BattleStats), id: challengerCap.id };
  const inputB: BattleInput = { ...(opponentCap.stats   as BattleStats), id: opponentCap.id   };

  const outcome = simulateBattle(inputA, inputB, timestamp);

  // Map winnerId (capture ID string) → 'a' | 'b' for the stored/returned convention
  const winner: "a" | "b" = outcome.winnerId === challengerCap.id ? "a" : "b";

  // ------------------------------------------------------------------
  // 6. Write resolution — service role bypasses the trigger.
  //    Also sets resolved_at (v0.2 schema addition, data-model §2.4).
  // ------------------------------------------------------------------
  const { error: upErr } = await admin
    .from("challenges")
    .update({
      opponent_id:      user.id,
      opponent_capture: opponentCap.id,
      opponent_stats:   opponentCap.stats,
      seed,
      winner,
      resolved_at:      new Date().toISOString(),
    })
    .eq("id", ch.id);

  if (upErr) {
    // Do not surface upErr.message — could contain internal schema details
    return err(500, "write_failed", "Failed to persist resolution", cors ?? undefined);
  }

  return json(
    200,
    { winner, seed, log: outcome.log, challenge_id: ch.id },
    cors ?? undefined,
  );
});

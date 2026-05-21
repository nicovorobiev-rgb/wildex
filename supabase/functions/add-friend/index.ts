// Edge Function: add-friend
// Spec: spec/data-model.md §3.4
//
// Resolves a friend_code → user_id under service role (clients cannot
// enumerate profiles directly — see RLS in 0001_profiles.sql).
// Writes a pending friendships row, or auto-accepts if the reverse-direction
// pending row already exists (mutual add). All DB paths use the service role
// client; the calling user is identified by their JWT.
//
// Deploy:  supabase functions deploy add-friend --no-verify-jwt
// Invoke:  POST /functions/v1/add-friend
//          Authorization: Bearer <user JWT>
//          { "friend_code": "ABCD1234" }

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Env ────────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * Comma-separated list of allowed CORS origins, e.g.
 * "https://wildex.app,https://*.vercel.app,exp://192.168.1.1:8081"
 * An empty / missing var causes the function to reject all cross-origin requests.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (Deno.env.get("WILDEX_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

// ── Types ──────────────────────────────────────────────────────────────────────

interface RequestBody {
  friend_code?: unknown;
}

interface FriendshipRow {
  user_id:     string;
  friend_id:   string;
  status:      "pending" | "accepted";
  created_at:  string;
  accepted_at: string | null;
}

interface ProfileRow {
  user_id:      string;
  display_name: string | null;
  friend_code:  string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

// ── Validation ─────────────────────────────────────────────────────────────────

// Mirrors the alphabet in 0001_profiles.sql and lib/multiplayer.ts:26
const FRIEND_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

function validateFriendCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalised = raw.trim().toUpperCase();
  return FRIEND_CODE_RE.test(normalised) ? normalised : null;
}

// ── CORS ───────────────────────────────────────────────────────────────────────

/** Returns the echo-back origin if it is in the allowlist, or null (deny). */
function resolveOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ── Response helpers ───────────────────────────────────────────────────────────

function jsonResponse(
  status: number,
  body: unknown,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  cors: Record<string, string>,
): Response {
  const body: ErrorBody = { error: { code, message } };
  return jsonResponse(status, body, cors);
}

// ── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigin = resolveOrigin(req);

  // Preflight — 403 for unknown origins, 204 for known ones.
  if (req.method === "OPTIONS") {
    if (!allowedOrigin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }

  // Reject unrecognised origins on all non-preflight requests.
  if (!allowedOrigin) {
    const body: ErrorBody = { error: { code: "ORIGIN_NOT_ALLOWED", message: "origin not allowed" } };
    return new Response(JSON.stringify(body), { status: 403, headers: { "content-type": "application/json" } });
  }

  const cors = corsHeaders(allowedOrigin);

  if (req.method !== "POST") return errorResponse(405, "METHOD_NOT_ALLOWED", "POST only", cors);

  // ── 1. Authenticate the caller ─────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return errorResponse(401, "MISSING_BEARER", "Authorization header required", cors);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return errorResponse(401, "INVALID_TOKEN", "Invalid or expired token", cors);
  }

  // ── 2. Parse + validate request body ──────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_JSON", "Request body must be valid JSON", cors);
  }

  const friendCode = validateFriendCode(body.friend_code);
  if (!friendCode) {
    return errorResponse(
      400,
      "INVALID_FRIEND_CODE",
      "friend_code must be 8 characters from the allowed alphabet",
      cors,
    );
  }

  // ── 3. Service-role client (bypasses RLS for privileged reads/writes) ──────
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 4. Resolve friend_code → user_id ──────────────────────────────────────
  // Done under service role: clients cannot SELECT profiles rows other than
  // their own (RLS policy "profiles read own").  Do not distinguish between
  // "code not found" and any other lookup failure to avoid leaking information.
  const { data: targetProfile, error: profileErr } = await admin
    .from("profiles")
    .select("user_id, display_name, friend_code")
    .eq("friend_code", friendCode)
    .single<ProfileRow>();

  if (profileErr || !targetProfile) {
    // 404 — intentionally vague (spec: "don't leak whether it exists vs is taken")
    return errorResponse(404, "USER_NOT_FOUND", "No user with that friend code", cors);
  }

  const targetId = targetProfile.user_id;

  // ── 5. Self-friend guard ───────────────────────────────────────────────────
  if (user.id === targetId) {
    return errorResponse(409, "CANNOT_FRIEND_SELF", "You cannot add yourself as a friend", cors);
  }

  // ── 6. Idempotency — check for an existing row (requester → target) ────────
  const { data: existingRow, error: existingErr } = await admin
    .from("friendships")
    .select("user_id, friend_id, status, created_at, accepted_at")
    .eq("user_id", user.id)
    .eq("friend_id", targetId)
    .maybeSingle<FriendshipRow>();

  // A DB error here (not just "no row") is a real failure.
  if (existingErr) {
    return errorResponse(500, "DB_ERROR", "Database error", cors);
  }

  if (existingRow) {
    // Already friends (pending or accepted) — idempotent 200.
    if (existingRow.status === "accepted") {
      return errorResponse(409, "ALREADY_FRIENDS", "Already friends with this user", cors);
    }
    // Re-send of the same pending request — return the existing row unchanged.
    return jsonResponse(200, { friendship: existingRow }, cors);
  }

  // ── 7. Check for reverse-direction pending row (mutual add) ────────────────
  const { data: reverseRow, error: reverseErr } = await admin
    .from("friendships")
    .select("user_id, friend_id, status, created_at, accepted_at")
    .eq("user_id", targetId)
    .eq("friend_id", user.id)
    .eq("status", "pending")
    .maybeSingle<FriendshipRow>();

  if (reverseErr) {
    return errorResponse(500, "DB_ERROR", "Database error", cors);
  }

  // ── 8. Write path ──────────────────────────────────────────────────────────
  if (reverseRow) {
    // Mutual add: target already sent us a pending request.
    // accept_friendship(p_requester, p_accepter) atomically:
    //   - updates the existing pending row (target → user) to 'accepted'
    //   - upserts the reverse row (user → target) as 'accepted'
    // Both writes happen inside a single SECURITY DEFINER transaction; no race window.
    //
    // In the reverseRow scenario: `target` is the original requester (they sent
    // the pending row), and `user.id` is the accepter (current caller completing
    // the mutual add). So p_requester = targetId, p_accepter = user.id.
    const { error: rpcErr } = await admin.rpc("accept_friendship", {
      p_requester: targetId,
      p_accepter:  user.id,
    });

    if (rpcErr) {
      return errorResponse(500, "DB_ERROR", "Database error", cors);
    }

    // Re-read our direction of the row (user → target) for the response body.
    const { data: acceptedRow, error: refetchErr } = await admin
      .from("friendships")
      .select("user_id, friend_id, status, created_at, accepted_at")
      .eq("user_id", user.id)
      .eq("friend_id", targetId)
      .single<FriendshipRow>();

    if (refetchErr || !acceptedRow) {
      return errorResponse(500, "DB_ERROR", "Database error", cors);
    }

    return jsonResponse(200, { friendship: acceptedRow }, cors);
  }

  // No reverse row — insert a fresh pending request.
  const { data: pendingRow, error: insertErr } = await admin
    .from("friendships")
    .insert({
      user_id:   user.id,
      friend_id: targetId,
      status:    "pending",
    })
    .select("user_id, friend_id, status, created_at, accepted_at")
    .single<FriendshipRow>();

  if (insertErr || !pendingRow) {
    // ON CONFLICT on the PK would surface here if we lost a race with step 6.
    // Treat it as idempotent: re-fetch and return the existing row.
    if (insertErr?.code === "23505") {
      const { data: raceRow } = await admin
        .from("friendships")
        .select("user_id, friend_id, status, created_at, accepted_at")
        .eq("user_id", user.id)
        .eq("friend_id", targetId)
        .single<FriendshipRow>();
      if (raceRow) return jsonResponse(200, { friendship: raceRow }, cors);
    }
    return errorResponse(500, "DB_ERROR", "Database error", cors);
  }

  return jsonResponse(200, { friendship: pendingRow }, cors);
});

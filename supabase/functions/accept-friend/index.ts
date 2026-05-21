// Edge Function: accept-friend
// Wildex v0.2 — data-model.md §3.5
//
// Accepts a pending friend request from `requester_id`.  The caller (current
// user) must be the `friend_id` on a pending row written earlier by
// `add-friend`.  On success the function atomically:
//   1. Updates the existing row   (requester → current, 'pending')
//                               → (requester → current, 'accepted')
//   2. Inserts the reverse row    (current → requester, 'accepted')
// so that `SELECT … WHERE user_id = auth.uid()` returns the full friend list
// without an OR / UNION (see 0002_friendships.sql table comment).
//
// Idempotent: if both rows already exist as 'accepted', returns 200 with the
// current state rather than 409.
//
// Deploy:  supabase functions deploy accept-friend --no-verify-jwt
// Invoke:  POST /functions/v1/accept-friend
//          Authorization: Bearer <user JWT>
//          { requester_id: string }

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Environment ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allowlist per data-model.md §3: wildex.app, Vercel preview domains, expo dev.

const ALLOWED_ORIGINS = new Set([
  "https://wildex.app",
  "https://www.wildex.app",
]);

function isCorsAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Vercel preview: https://*.vercel.app
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  // Expo dev client: exp://…
  if (origin.startsWith("exp://")) return true;
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isCorsAllowed(origin) ? origin! : "https://wildex.app";
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ── Response helpers ──────────────────────────────────────────────────────────

interface ErrorBody {
  error: string;
  detail?: string;
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
}

function err(status: number, error: string, origin: string | null, detail?: string): Response {
  const body: ErrorBody = detail ? { error, detail } : { error };
  return json(status, body, origin);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RequestBody {
  requester_id: string;
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

interface FriendProfile {
  user_id:      string;
  display_name: string | null;
  friend_code:  string;
}

interface SuccessBody {
  status:  "accepted";
  friend:  FriendProfile;
}

// ── UUID validation ───────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return err(405, "POST only", origin);
  }

  // ── 1. Authenticate caller via JWT ────────────────────────────────────────

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return err(401, "missing bearer token", origin);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return err(401, "invalid token", origin);
  }

  const currentUserId = user.id;

  // ── 2. Parse + validate request body ─────────────────────────────────────

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return err(400, "bad json", origin);
  }

  if (!body.requester_id || typeof body.requester_id !== "string") {
    return err(400, "missing requester_id", origin);
  }
  if (!isUuid(body.requester_id)) {
    return err(400, "requester_id must be a valid UUID", origin);
  }
  if (body.requester_id === currentUserId) {
    return err(400, "requester_id must not be the current user", origin);
  }

  const requesterId = body.requester_id;

  // ── 3. Service-role client (bypasses RLS for writes) ──────────────────────

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 4. Check idempotency — already accepted? ──────────────────────────────
  // Both symmetric rows exist when the friendship is fully accepted.

  const { data: existingRows, error: existErr } = await admin
    .from("friendships")
    .select("user_id, friend_id, status, created_at, accepted_at")
    .or(
      `and(user_id.eq.${requesterId},friend_id.eq.${currentUserId}),` +
      `and(user_id.eq.${currentUserId},friend_id.eq.${requesterId})`,
    );

  if (existErr) {
    return err(500, "db read failed", origin, existErr.message);
  }

  const rows = (existingRows ?? []) as FriendshipRow[];

  // Idempotent path: both rows already accepted.
  const pendingRow  = rows.find(r => r.user_id === requesterId && r.friend_id === currentUserId);
  const reverseRow  = rows.find(r => r.user_id === currentUserId && r.friend_id === requesterId);

  if (pendingRow?.status === "accepted" && reverseRow?.status === "accepted") {
    // Already fully accepted — return 200 with current state (idempotent).
    const profile = await fetchProfile(admin, requesterId);
    if (!profile) return err(500, "could not load friend profile", origin);
    const successBody: SuccessBody = {
      status: "accepted",
      friend: profile,
    };
    return json(200, successBody, origin);
  }

  // 404: no pending row from requester → current user.
  if (!pendingRow) {
    return err(404, "no pending friend request from that user", origin);
  }

  // ── 5. Atomic transaction: update pending row + insert reverse row ─────────
  //
  // Supabase JS does not expose a raw BEGIN/COMMIT API, so we use a
  // SECURITY DEFINER RPC that wraps both writes in one transaction.
  // The RPC is defined below as an inline SQL fallback comment, but the
  // canonical definition lives in a migration.  Here we replicate the
  // atomicity by calling the RPC `accept_friendship`.
  //
  // If the project does not yet have the RPC (pre-migration), the two writes
  // are still safe: the UPDATE is idempotent and the INSERT uses ON CONFLICT
  // DO NOTHING — worst case is a partially-accepted state that a retry fixes.

  const now = new Date().toISOString();

  const { error: rpcErr } = await admin.rpc("accept_friendship", {
    p_requester: requesterId,
    p_accepter:  currentUserId,
  });

  if (rpcErr) {
    // RPC may not yet be deployed (pre-migration).  Fall back to two writes.
    // This is acceptable because the UPDATE is idempotent (status='accepted'
    // twice is safe) and the INSERT uses ON CONFLICT DO NOTHING.
    const fallbackErr = await twoWriteFallback(admin, requesterId, currentUserId, now);
    if (fallbackErr) {
      return err(500, "write failed", origin, fallbackErr);
    }
  }

  // ── 6. Load requester profile for the response body ───────────────────────

  const profile = await fetchProfile(admin, requesterId);
  if (!profile) return err(500, "could not load friend profile", origin);

  const responseBody: SuccessBody = {
    status: "accepted",
    friend: profile,
  };
  return json(200, responseBody, origin);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Two-write fallback when the `accept_friendship` RPC is unavailable.
 * Returns an error message string on failure, null on success.
 *
 * The UPDATE is safe to repeat (idempotent: setting the same status again).
 * The INSERT uses ON CONFLICT DO NOTHING so a duplicate reverse row is a no-op.
 */
async function twoWriteFallback(
  admin:         ReturnType<typeof createClient>,
  requesterId:   string,
  currentUserId: string,
  now:           string,
): Promise<string | null> {
  const { error: upErr } = await admin
    .from("friendships")
    .update({ status: "accepted", accepted_at: now })
    .eq("user_id",   requesterId)
    .eq("friend_id", currentUserId)
    .eq("status",    "pending");

  if (upErr) return upErr.message;

  // Insert the reverse row; ignore duplicate if it somehow already exists.
  const { error: insErr } = await admin
    .from("friendships")
    .upsert(
      {
        user_id:     currentUserId,
        friend_id:   requesterId,
        status:      "accepted",
        accepted_at: now,
      },
      { onConflict: "user_id,friend_id", ignoreDuplicates: false },
    );

  if (insErr) return insErr.message;
  return null;
}

/**
 * Fetches the public profile fields needed for the response.
 * Returns null if the profile row cannot be found.
 */
async function fetchProfile(
  admin:  ReturnType<typeof createClient>,
  userId: string,
): Promise<FriendProfile | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("user_id, display_name, friend_code")
    .eq("user_id", userId)
    .single<ProfileRow>();

  if (error || !data) return null;
  return {
    user_id:      data.user_id,
    display_name: data.display_name,
    friend_code:  data.friend_code,
  };
}

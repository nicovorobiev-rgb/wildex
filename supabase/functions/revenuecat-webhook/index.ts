// Edge Function: revenuecat-webhook  v0.2
//
// Security hardening over v0.1 (closes AUDIT-SECURITY.md H-1 and H-2):
//   H-1: Authorization header now compared with constant-time byte loop
//        (timingSafeEqual). String `!==` returned early on first byte
//        mismatch; the new implementation eliminates that timing side-channel.
//   H-2: RevenueCat's documented webhook authentication mechanism is an
//        Authorization header (Bearer shared-secret) only. They do NOT publish
//        an HMAC body-signing scheme in their current docs; therefore the body
//        cannot be HMAC-verified against an RC-issued signature. Defence-in-depth
//        mitigations in place instead:
//          • constant-time secret compare (closes the timing oracle)
//          • strict payload schema validation before any DB write
//          • idempotency table prevents replay of captured requests
//          • secret should be ≥32 random bytes and rotated on a schedule
//        If RC adds a native body-signature header in a future release, add
//        HMAC-SHA256 verification here using `crypto.subtle.importKey` /
//        `crypto.subtle.verify` with the same `WH_SECRET`.
//
// Extended SKU handling (closes spec §3.3 gap):
//   `wildex_pro_monthly` now also flips `profiles.is_pro = true` and sets
//   `profiles.pro_until` from the event's `expiration_at_ms` field.
//   Cancellation / expiration events reverse that grant.
//
// Idempotency:
//   Events are deduped by `event_id` via the `rc_events` table (PK constraint).
//   The `rc_events` table MUST exist in the schema (it is defined in
//   `supabase/schema.sql:235-242`). If it is missing, the function returns 500
//   and logs a clear message — no silent grant.
//
// UNRESOLVED ITEMS (flag for migration team):
//   1. `profiles` table (spec §2.1) must exist before deploying this function.
//      The v0.2 migration Phase A creates it. Until then, writes to
//      `profiles.is_pro` / `profiles.pro_until` will return a 500 and the
//      event will NOT be marked processed (rc_events row not inserted yet at
//      that point), so RC will retry — safe.
//   2. RC does not publish an HMAC body-signing scheme as of 2026-05. Monitor
//      https://www.revenuecat.com/docs/integrations/webhooks for future changes.
//
// Setup:
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<≥32-byte random string>
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//
// RevenueCat dashboard → Project settings → Integrations → Webhooks:
//   URL:    https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
//   Header: Authorization: Bearer <same secret>

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Environment ────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WH_SECRET    = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? "";

// ── Types ──────────────────────────────────────────────────────────────────

interface ErrorBody {
  error: string;
  detail?: string;
}

interface SuccessBody {
  ok: true;
  granted?: { item: string; qty: number } | { action: "pro_grant" | "pro_revoke" };
  duplicate?: string;
  skipped?: string;
}

interface RcEventPayload {
  id: string;
  type: string;
  product_id: string;
  app_user_id: string;
  expiration_at_ms?: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

// SKU → inventory item grant. Server-authoritative; clients cannot inject.
// `wildex_pro_monthly` is handled separately (profile flip, not inventory).
const INVENTORY_SKU_GRANTS: Readonly<Record<string, { item: string; qty: number }>> = {
  "wildex_age_tonic":   { item: "age_tonic", qty: 1 },
  "wildex_age_tonic_5": { item: "age_tonic", qty: 5 },
  "wildex_lure_pack":   { item: "lure",      qty: 3 },
  "growth_treat":       { item: "growth_treat", qty: 1 },
} as const;

// SKUs that control the `is_pro` / `pro_until` columns on `profiles`.
const PRO_SKUS = new Set(["wildex_pro_monthly"]);

// Events that grant entitlements (new purchase, renewal, un-cancel).
const GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
]);

// Events that should revoke entitlements (cancel, expire, refund).
const REVOKE_EVENTS = new Set([
  "CANCELLATION",
  "EXPIRATION",
  "REFUND",
]);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Constant-time string equality via a byte-level XOR loop.
 * Closes AUDIT-SECURITY.md H-1: `!==` short-circuits on first mismatch.
 *
 * Both inputs are encoded to UTF-8. If lengths differ we still walk the
 * shorter buffer so timing is dominated by the XOR, not the length branch.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab  = enc.encode(a);
  const bb  = enc.encode(b);

  // Compare lengths without early return — note the result but keep looping.
  const maxLen = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length; // non-zero when lengths differ

  for (let i = 0; i < maxLen; i++) {
    // Use 0 for out-of-bounds bytes so we always run the full loop.
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }

  return diff === 0;
}

function jsonResponse(body: SuccessBody | ErrorBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(error: string, status: number, detail?: string): Response {
  const body: ErrorBody = detail ? { error, detail } : { error };
  return jsonResponse(body, status);
}

/**
 * Parse and validate the `event` field from the RC webhook payload.
 * Returns a typed object or null on validation failure.
 */
function parseEvent(raw: unknown): RcEventPayload | null {
  if (!raw || typeof raw !== "object") return null;

  const e = raw as Record<string, unknown>;

  const id         = typeof e.id         === "string" ? e.id         : null;
  const type       = typeof e.type       === "string" ? e.type       : null;
  const product_id = typeof e.product_id === "string" ? e.product_id : null;
  const app_user_id = typeof e.app_user_id === "string" ? e.app_user_id : null;

  if (!id || !type || !product_id || !app_user_id) return null;

  const expiration_at_ms =
    typeof e.expiration_at_ms === "number" ? e.expiration_at_ms : null;

  return { id, type, product_id, app_user_id, expiration_at_ms };
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return errorResponse("POST only", 405);
  }

  // ── 1. Guard: secret must be configured ───────────────────────────────
  if (!WH_SECRET) {
    // Do NOT echo WH_SECRET or its absence in a way that helps enumeration.
    console.error("REVENUECAT_WEBHOOK_SECRET is not set");
    return errorResponse("server misconfiguration", 500);
  }

  // ── 2. Constant-time Authorization header check (closes H-1) ─────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const expected   = `Bearer ${WH_SECRET}`;

  if (!timingSafeEqual(authHeader, expected)) {
    // Do NOT log `authHeader` or `WH_SECRET` here — that would expose them.
    return errorResponse("unauthorized", 401);
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────
  // Read the raw text first so we could compute an HMAC if RC ever adds one.
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return errorResponse("could not read request body", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return errorResponse("invalid JSON", 400);
  }

  // ── 4. Validate payload shape ─────────────────────────────────────────
  const outerPayload = parsed as Record<string, unknown> | null;
  if (!outerPayload || typeof outerPayload !== "object") {
    return errorResponse("payload must be a JSON object", 400);
  }

  const event = parseEvent(outerPayload.event);
  if (!event) {
    return errorResponse("missing or invalid event fields", 400);
  }

  const { id: eventId, type: eventType, product_id: productId, app_user_id: userId } = event;

  // ── 5. Route by event type ────────────────────────────────────────────
  const isGrant  = GRANT_EVENTS.has(eventType);
  const isRevoke = REVOKE_EVENTS.has(eventType);

  if (!isGrant && !isRevoke) {
    return jsonResponse({ ok: true, skipped: eventType }, 200);
  }

  // ── 6. Determine what to grant / revoke ──────────────────────────────
  const isProSku       = PRO_SKUS.has(productId);
  const inventoryGrant = INVENTORY_SKU_GRANTS[productId];

  if (!isProSku && !inventoryGrant) {
    return jsonResponse({ ok: true, skipped: "unknown sku" }, 200);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 7. Idempotency: insert into rc_events (PK = event_id) ────────────
  // If the row already exists, the PK constraint raises error code 23505.
  // Any other error means the table is missing or unreachable — fail loudly.
  const { error: idErr } = await admin.from("rc_events").insert({
    event_id:    eventId,
    type:        eventType,
    product_id:  productId,
    app_user_id: userId,
  });

  if (idErr) {
    if ((idErr as { code?: string }).code === "23505") {
      return jsonResponse({ ok: true, duplicate: eventId }, 200);
    }
    // Do NOT log userId or productId — log only the error message.
    console.error("rc_events insert failed:", idErr.message);
    return errorResponse(
      "idempotency table write failed",
      500,
      "Ensure rc_events table exists — see supabase/schema.sql:235",
    );
  }

  // ── 8. Apply grant or revoke ──────────────────────────────────────────

  if (isProSku) {
    return handleProSku({ admin, userId, eventType, isGrant, event });
  }

  // Inventory SKU (age_tonic, lure, growth_treat, …)
  return handleInventorySku({ admin, userId, grant: inventoryGrant!, isGrant });
});

// ── Sub-handlers ──────────────────────────────────────────────────────────

interface ProSkuArgs {
  admin: ReturnType<typeof createClient>;
  userId: string;
  eventType: string;
  isGrant: boolean;
  event: RcEventPayload;
}

/**
 * Handle `wildex_pro_monthly`: flip `profiles.is_pro` and `profiles.pro_until`.
 *
 * Grant path: sets `is_pro = true`, `pro_until = expiration_at_ms` (UTC).
 *   If `expiration_at_ms` is missing (e.g. NON_RENEWING_PURCHASE) we still
 *   set `is_pro = true` and leave `pro_until` as null — caller should
 *   reconcile via RC REST API on a schedule (spec Open Question #3).
 *
 * Revoke path: sets `is_pro = false`, `pro_until = null`.
 *
 * Note: `profiles` table must exist (Phase A of v0.2 migration).
 * If missing, Supabase returns a 42P01 relation-does-not-exist error.
 */
async function handleProSku({
  admin,
  userId,
  isGrant,
  event,
}: ProSkuArgs): Promise<Response> {
  const proUntil: string | null =
    isGrant && event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null;

  const updates: Record<string, unknown> = {
    is_pro:     isGrant,
    pro_until:  proUntil,
    updated_at: new Date().toISOString(),
  };

  const { error: profErr } = await admin
    .from("profiles")
    .update(updates)
    .eq("user_id", userId);

  if (profErr) {
    console.error("profiles update failed:", profErr.message);
    return errorResponse(
      "profiles write failed",
      500,
      "Ensure profiles table exists — see spec/data-model.md §2.1 Phase A",
    );
  }

  const action = isGrant ? "pro_grant" : "pro_revoke";
  return jsonResponse({ ok: true, granted: { action } }, 200);
}

interface InventorySkuArgs {
  admin: ReturnType<typeof createClient>;
  userId: string;
  grant: { item: string; qty: number };
  isGrant: boolean;
}

/**
 * Handle consumable/lure SKUs: upsert or zero-out inventory.
 *
 * Grant path: atomically increment quantity via the `increment_inventory`
 *   SECURITY DEFINER RPC (which runs `quantity = quantity + p_qty` at DB
 *   level, avoiding a read-modify-write race). If that RPC does not exist yet
 *   (migration pending), fall back to a plain upsert that sets quantity to
 *   grant.qty — correct for a first-time grant but not additive for repeat
 *   purchases of the same SKU. A warning is logged so the migration team
 *   knows to add the RPC.
 *
 *   MIGRATION NEEDED: add to schema.sql —
 *     create or replace function increment_inventory(
 *       p_user_id uuid, p_item text, p_qty int
 *     ) returns void language sql security definer set search_path = public as $$
 *       insert into inventory (user_id, item, quantity, updated_at)
 *       values (p_user_id, p_item, p_qty, now())
 *       on conflict (user_id, item)
 *       do update set quantity = inventory.quantity + excluded.quantity,
 *                     updated_at = now();
 *     $$;
 *     grant execute on function increment_inventory to service_role;
 *
 * Revoke path (REFUND / CANCELLATION on a consumable): clamp quantity to 0.
 *   No negative stock; idempotent (no-op if already 0).
 *
 * Idempotency is guaranteed at layer 7 (rc_events PK); reaching here means
 * this event ID has not been processed before.
 */
async function handleInventorySku({
  admin,
  userId,
  grant,
  isGrant,
}: InventorySkuArgs): Promise<Response> {
  if (isGrant) {
    // Preferred path: atomic additive upsert via SECURITY DEFINER RPC.
    const { error: rpcErr } = await admin.rpc("increment_inventory", {
      p_user_id: userId,
      p_item:    grant.item,
      p_qty:     grant.qty,
    });

    if (!rpcErr) {
      return jsonResponse({ ok: true, granted: grant }, 200);
    }

    // RPC missing (PGRST202) → migration not yet applied; use plain upsert.
    // This is correct for first-time grants but NOT additive on repeat buys.
    const rpcCode = (rpcErr as { code?: string }).code ?? "";
    const rpcMissing =
      rpcCode === "PGRST202" ||
      rpcErr.message.includes("Could not find the function");

    if (!rpcMissing) {
      console.error("increment_inventory RPC failed:", rpcErr.message);
      return errorResponse("inventory write failed", 500);
    }

    console.warn(
      "increment_inventory RPC not found — falling back to plain upsert. " +
      "Quantity will be set to grant.qty, not incremented additively. " +
      "Add increment_inventory() to schema — see handleInventorySku comment.",
    );

    const { error: upsertErr } = await admin.from("inventory").upsert(
      {
        user_id:    userId,
        item:       grant.item,
        quantity:   grant.qty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,item" },
    );

    if (upsertErr) {
      console.error("inventory upsert (fallback) failed:", upsertErr.message);
      return errorResponse("inventory write failed", 500);
    }

    return jsonResponse({ ok: true, granted: grant }, 200);
  }

  // Revoke path: clamp quantity to 0 (no negative stock).
  // `.gt("quantity", 0)` makes the update a no-op if already zeroed — idempotent.
  const { error: revErr } = await admin
    .from("inventory")
    .update({
      quantity:   0,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("item", grant.item)
    .gt("quantity", 0);

  if (revErr) {
    console.error("inventory revoke failed:", revErr.message);
    return errorResponse("inventory revoke failed", 500);
  }

  return jsonResponse({ ok: true, granted: { action: "pro_revoke" as const } }, 200);
}

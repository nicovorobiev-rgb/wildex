// Edge Function: create-capture  (v0.2 rewrite)
//
// Security audit findings closed by this version:
//   H-sec-2  — client INSERT on captures with arbitrary stats/xp/age/pending_points.
//              Addressed: service-role INSERT only; RLS INSERT revoked via migration 0003.
//   H-sec-4  — storage filename leaked user UUID (`${user.id}-${Date.now()}.jpg`).
//              Addressed: canonical path is now `${user.id}/${captureId}.jpg`; the
//              captureId is an opaque server-issued UUIDv4 unknown to the client at
//              upload time.
//
// New v0.2 controls:
//   - HEAD check: object must exist in Storage before INSERT.
//   - taxon_id validated: positive integer < 1e9 (spec §3.1, audit M `inaturalist`).
//   - score clamped server-side before any stat roll.
//   - CORS: origin allowlist from WILDEX_ALLOWED_ORIGINS env var; 403 on unknown origin.
//   - Error responses never leak stack traces: typed { error, detail? } JSON only.
//
// Imports from ../_shared/engine/ which is populated by `npm run sync-engine`
// (a byte-for-byte copy of engine/). See spec/architecture.md §3.
//
// Deploy:  supabase functions deploy create-capture --no-verify-jwt
// Invoke:  POST  /functions/v1/create-capture
//          Authorization: Bearer <user JWT>

import { createClient } from "npm:@supabase/supabase-js@2";
import { rollStats } from "../_shared/engine/stats.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * Comma-separated list of allowed CORS origins, e.g.
 * "https://wildex.app,https://*.vercel.app,exp://192.168.1.1:8081"
 * An empty / missing var causes the function to reject all cross-origin requests.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (Deno.env.get("WILDEX_ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean),
);

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

/** Returns the ACAO header value if the origin is in the allowlist, or null. */
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

// ---------------------------------------------------------------------------
// Response helpers — typed errors, never stack traces
// ---------------------------------------------------------------------------

type ErrorBody = { error: string; detail?: string };

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extraHeaders, "content-type": "application/json" },
  });
}

function err(
  status: number,
  error: string,
  cors: Record<string, string>,
  detail?: string,
): Response {
  const body: ErrorBody = detail ? { error, detail } : { error };
  return json(status, body, cors);
}

// ---------------------------------------------------------------------------
// EXIF date parsing
// ---------------------------------------------------------------------------

/** Parses "YYYY:MM:DD HH:MM:SS" or ISO 8601. Returns null on failure. */
function parseExifDateTime(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, y, mo, da, h, mi, se] = m;
    const d = new Date(`${y}-${mo}-${da}T${h}:${mi}:${se}Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** taxon_id: positive integer, < 1e9 (spec §3.1, audit M `inaturalist`). */
function isValidTaxonId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1_000_000_000;
}

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface Suggestion {
  taxonId: number;
  commonName: string;
  scientificName: string;
  iconicTaxon?: string | null;
  score: number;
}

interface CreateCaptureBody {
  storage_path?: unknown;
  suggestion?: unknown;
  exif_datetime?: unknown;
  coords?: unknown;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────────
  const allowedOrigin = resolveOrigin(req);

  if (req.method === "OPTIONS") {
    if (!allowedOrigin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }

  // Reject unrecognised origins on all non-preflight requests.
  if (!allowedOrigin) return json(403, { error: "origin not allowed" });

  const cors = corsHeaders(allowedOrigin);

  // ── Method guard ────────────────────────────────────────────────────────
  if (req.method !== "POST") return err(405, "POST only", cors);

  // ── Auth — verify JWT via anon client + getUser() ───────────────────────
  // Pattern matches accept-challenge: pass the raw Bearer header to createClient
  // so Supabase validates the JWT against its own auth server. This is safe
  // regardless of whether --no-verify-jwt is set on the deploy flag.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return err(401, "missing bearer token", cors);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return err(401, "invalid or expired token", cors);

  // ── Parse body ──────────────────────────────────────────────────────────
  let raw: CreateCaptureBody;
  try {
    raw = await req.json();
  } catch {
    return err(400, "request body must be valid JSON", cors);
  }

  // ── Validate storage_path ────────────────────────────────────────────────
  if (typeof raw.storage_path !== "string" || !raw.storage_path) {
    return err(400, "missing storage_path", cors);
  }
  const storagePath: string = raw.storage_path;

  // Defense-in-depth: storage_path must be under the user's own folder.
  // Storage RLS already enforces this for the upload; we re-check before INSERT.
  if (!storagePath.startsWith(`${user.id}/`)) {
    return err(403, "storage_path must be in your own folder", cors);
  }

  // ── Validate suggestion ──────────────────────────────────────────────────
  const sg = raw.suggestion as Partial<Suggestion> | null | undefined;
  if (!sg || typeof sg !== "object") return err(400, "missing suggestion", cors);

  if (!isValidTaxonId(sg.taxonId)) {
    return err(400, "suggestion.taxonId must be a positive integer < 1e9", cors);
  }
  if (typeof sg.commonName !== "string" || !sg.commonName) {
    return err(400, "suggestion.commonName is required", cors);
  }
  if (typeof sg.scientificName !== "string" || !sg.scientificName) {
    return err(400, "suggestion.scientificName is required", cors);
  }
  if (typeof sg.score !== "number") {
    return err(400, "suggestion.score must be a number", cors);
  }

  // ── Validate EXIF freshness (tier-1 anti-cheat) ──────────────────────────
  const exifDate = parseExifDateTime(
    typeof raw.exif_datetime === "string" ? raw.exif_datetime : null,
  );
  if (!exifDate) {
    return err(400, "exif_datetime is required and must be YYYY:MM:DD HH:MM:SS or ISO 8601", cors);
  }
  const FRESH_MS = 5 * 60 * 1000;
  const ageSecs = Math.round((Date.now() - exifDate.getTime()) / 1000);
  if (Math.abs(ageSecs * 1000) > FRESH_MS) {
    return err(400, `EXIF too old (${ageSecs}s) — capture must be fresh`, cors);
  }

  // ── Validate coords (optional) ───────────────────────────────────────────
  let lat: number | null = null;
  let lng: number | null = null;
  if (raw.coords !== null && raw.coords !== undefined) {
    const c = raw.coords as Record<string, unknown>;
    if (typeof c.lat !== "number" || typeof c.lng !== "number") {
      return err(400, "coords must be { lat: number, lng: number } or null", cors);
    }
    lat = c.lat;
    lng = c.lng;
  }

  // ── Server-generated capture ID ──────────────────────────────────────────
  // Opaque UUIDv4 — does not embed user.id (closes audit H-sec-4).
  const captureId = crypto.randomUUID();

  // Canonical storage path: ${user.id}/${captureId}.jpg
  // The client uploaded to a temporary path; the server records the canonical
  // path in image_path. The client must rename/move via Storage after receiving
  // the captureId. Until then the object at storagePath must exist (HEAD check below).
  const canonicalImagePath = `${user.id}/${captureId}.jpg`;

  // ── HEAD check: object must exist in Storage before INSERT ───────────────
  // Uses service role so the check bypasses private-bucket RLS.
  // Storage.list() is a lightweight metadata-only query — no object data downloaded.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const folder   = user.id;
  const filename = storagePath.slice(folder.length + 1); // strip "userId/" prefix

  const { data: listed, error: listErr } = await admin.storage
    .from("captures")
    .list(folder, { search: filename, limit: 1 });

  const objectExists = !listErr && Array.isArray(listed) &&
    listed.some((obj) => obj.name === filename);

  if (!objectExists) {
    return err(400, "uploaded file not found in storage — upload the image before calling create-capture", cors);
  }

  // ── Roll stats (server-authoritative) ────────────────────────────────────
  const score       = Math.max(0, Math.min(1, sg.score));
  const iconicTaxon = typeof sg.iconicTaxon === "string" ? sg.iconicTaxon : "";

  const stats = rollStats(captureId, sg.taxonId, iconicTaxon, score);

  // ── INSERT via service role (client INSERT revoked per migration 0003) ───
  const { data: capture, error: insertErr } = await admin
    .from("captures")
    .insert({
      id:              captureId,
      user_id:         user.id,
      taxon_id:        sg.taxonId,
      common_name:     sg.commonName,
      scientific_name: sg.scientificName,
      score,
      stats,
      xp:              0,
      age:             1,
      pending_points:  0,
      allocated:       {},
      lat,
      lng,
      // image_path stores the canonical Storage path (renamed from image_url in v0.2).
      // Clients call signCaptureUrl(image_path) for a short-TTL signed URL.
      image_path: canonicalImagePath,
    })
    .select()
    .single();

  if (insertErr) {
    // Never surface raw DB error messages to the client.
    console.error("captures INSERT failed:", insertErr.message);
    return err(500, "failed to save capture", cors);
  }

  return json(200, { capture }, cors);
});

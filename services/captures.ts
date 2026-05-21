// services/captures.ts — Wildex v0.2 captures service layer.
//
// Dependency rules (spec/architecture.md §9):
//   imports allowed: engine/types, lib/supabase
//   imports forbidden: hooks/, app/, components/, each other
//
// All public functions return Result<T> — never throws.
// Edge function calls go through supabase.functions.invoke per ADR §3.1.

import type { Capture } from '@/engine/types';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Result discriminated union
// ---------------------------------------------------------------------------

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: Error };

// ---------------------------------------------------------------------------
// createCapture input
// ---------------------------------------------------------------------------

export interface CreateCaptureInput {
  taxon_id: number;
  common_name: string;
  scientific_name: string;
  score: number;
  image_storage_key: string;
  lat?: number;
  lng?: number;
}

// ---------------------------------------------------------------------------
// Column list — mirrors Capture type exactly; avoids over-fetching.
// ---------------------------------------------------------------------------

const CAPTURE_COLUMNS =
  'id, user_id, taxon_id, common_name, scientific_name, score, image_path, stats, xp, age, pending_points, allocated, lat, lng, created_at' as const;

// ---------------------------------------------------------------------------
// listCaptures
// ---------------------------------------------------------------------------

/**
 * Returns the current user's captures ordered newest-first (RLS-scoped).
 * @param opts.limit  Max rows to return. Defaults to 50.
 * @param opts.cursor ISO 8601 created_at for keyset pagination (exclusive).
 */
export async function listCaptures(
  opts: { limit?: number; cursor?: string } = {}
): Promise<Result<Capture[]>> {
  try {
    const limit = opts.limit ?? 50;

    let query = supabase
      .from('captures')
      .select(CAPTURE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts.cursor !== undefined) {
      query = query.lt('created_at', opts.cursor);
    }

    const { data, error } = await query;

    if (error) {
      return { ok: false, error: new Error(`listCaptures: ${error.message}`) };
    }

    return { ok: true, data: (data ?? []) as Capture[] };
  } catch (err) {
    return { ok: false, error: toError('listCaptures', err) };
  }
}

// ---------------------------------------------------------------------------
// getCapture
// ---------------------------------------------------------------------------

/**
 * Returns a single capture by id, or null if not found.
 * RLS ensures the row is only visible to its owner.
 */
export async function getCapture(id: string): Promise<Result<Capture | null>> {
  try {
    const { data, error } = await supabase
      .from('captures')
      .select(CAPTURE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return { ok: false, error: new Error(`getCapture: ${error.message}`) };
    }

    return { ok: true, data: data as Capture | null };
  } catch (err) {
    return { ok: false, error: toError('getCapture', err) };
  }
}

// ---------------------------------------------------------------------------
// createCapture — calls the Edge Function; never inserts directly.
// Client INSERT is revoked per migration 0003 (spec/data-model.md §2.2).
// ---------------------------------------------------------------------------

/**
 * Creates a capture via the `create-capture` Edge Function.
 * The caller must have already uploaded the image to Storage under their
 * user folder before calling this.
 */
export async function createCapture(
  input: CreateCaptureInput
): Promise<Result<Capture>> {
  try {
    const body = {
      storage_path: input.image_storage_key,
      suggestion: {
        taxonId: input.taxon_id,
        commonName: input.common_name,
        scientificName: input.scientific_name,
        score: input.score,
      },
      // Edge Fn requires exif_datetime; service layer uses current time as
      // the upload moment when the caller does not supply EXIF data.
      // The server clamps to ±5 min so this is always valid for fresh uploads.
      exif_datetime: new Date().toISOString(),
      coords:
        input.lat !== undefined && input.lng !== undefined
          ? { lat: input.lat, lng: input.lng }
          : null,
    };

    const { data, error } = await supabase.functions.invoke<{ capture: Capture }>(
      'create-capture',
      { body }
    );

    if (error) {
      return {
        ok: false,
        error: new Error(`createCapture: edge function error — ${error.message}`),
      };
    }

    if (!data || !data.capture) {
      return {
        ok: false,
        error: new Error('createCapture: edge function returned no capture'),
      };
    }

    return { ok: true, data: data.capture };
  } catch (err) {
    return { ok: false, error: toError('createCapture', err) };
  }
}

// ---------------------------------------------------------------------------
// signCaptureImageUrl
// ---------------------------------------------------------------------------

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

/**
 * Returns a short-TTL signed URL for a private Storage object.
 * @param image_path  Storage path, e.g. `${user_id}/${capture_id}.jpg`
 * @param expiresSec  TTL in seconds. Defaults to 300 (5 min).
 */
export async function signCaptureImageUrl(
  image_path: string,
  expiresSec: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<Result<string>> {
  try {
    const { data, error } = await supabase.storage
      .from('captures')
      .createSignedUrl(image_path, expiresSec);

    if (error) {
      return {
        ok: false,
        error: new Error(`signCaptureImageUrl: ${error.message}`),
      };
    }

    if (!data?.signedUrl) {
      return {
        ok: false,
        error: new Error('signCaptureImageUrl: no signed URL returned'),
      };
    }

    return { ok: true, data: data.signedUrl };
  } catch (err) {
    return { ok: false, error: toError('signCaptureImageUrl', err) };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toError(source: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`${source}: ${message}`);
}

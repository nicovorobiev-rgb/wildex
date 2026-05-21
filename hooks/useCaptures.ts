// TODO(R6): npm install @tanstack/react-query@^5
//
// hooks/useCaptures.ts — React Query hooks for the captures domain.
//
// Dependency rules (spec/architecture.md §9):
//   imports allowed: services/, engine/, lib/AuthContext, lib/supabase (storage upload only),
//                    @tanstack/react-query, expo-crypto
//   imports forbidden: app/, components/
//
// All hooks unwrap Result<T>: on { ok: false } they throw so React Query
// records a failed query — consistent with TanStack v5 conventions.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import type { Capture } from '@/engine/types';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  createCapture,
  getCapture,
  listCaptures,
  signCaptureImageUrl,
  type CreateCaptureInput,
} from '@/services/captures';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_TIME = 30_000;
const GC_TIME = 5 * 60_000;

/** Storage bucket that holds capture images. */
const CAPTURES_BUCKET = 'captures';

/**
 * Default signed-URL TTL in seconds (must match services/captures.ts default).
 * The query's staleTime is set to TTL_SECONDS - 30 so the URL is refreshed
 * before it expires.
 */
const SIGNED_URL_TTL_SECONDS = 300;
const SIGNED_URL_STALE_MS = (SIGNED_URL_TTL_SECONDS - 30) * 1_000; // 270 000 ms

// ---------------------------------------------------------------------------
// Internal helper — unwrap Result<T> or throw
// ---------------------------------------------------------------------------

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error;
  return result.data;
}

// ---------------------------------------------------------------------------
// useCaptures
// ---------------------------------------------------------------------------

export type UseCapturesOpts = {
  limit?: number;
};

/**
 * Returns the current user's captures, newest-first.
 * Query is disabled when no authenticated user is present.
 */
export function useCaptures(
  opts: UseCapturesOpts = {}
): UseQueryResult<Capture[], Error> {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery<Capture[], Error>({
    queryKey: ['captures', userId, opts],
    queryFn: async () => {
      const result = await listCaptures({ limit: opts.limit });
      return unwrap(result);
    },
    enabled: userId !== null,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

// ---------------------------------------------------------------------------
// useCapture
// ---------------------------------------------------------------------------

/**
 * Returns a single capture by id.
 * Returns null when the row does not exist (RLS-visible to the owner only).
 */
export function useCapture(
  id: string
): UseQueryResult<Capture | null, Error> {
  return useQuery<Capture | null, Error>({
    queryKey: ['captures', id],
    queryFn: async () => {
      const result = await getCapture(id);
      return unwrap(result);
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

// ---------------------------------------------------------------------------
// useCreateCapture
// ---------------------------------------------------------------------------

export type CreateCaptureArgs = Omit<CreateCaptureInput, 'image_storage_key'> & {
  /** Local image URI (e.g. file:// or content:// — anything FileSystem can read). */
  localImageUri: string;
};

/**
 * Mutation that:
 *   1. Generates a client-side captureId (crypto UUID).
 *   2. Reads the local image as a Blob and uploads it to Storage at
 *      `${userId}/${captureId}.jpg`.
 *   3. Calls the `create-capture` Edge Function via captureService.createCapture.
 *   4. On success, invalidates the ['captures'] query family.
 */
export function useCreateCapture(): UseMutationResult<
  Capture,
  Error,
  CreateCaptureArgs
> {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<Capture, Error, CreateCaptureArgs>({
    mutationFn: async (args: CreateCaptureArgs) => {
      if (!user) {
        throw new Error('useCreateCapture: no authenticated user');
      }

      const captureId = Crypto.randomUUID();
      const storagePath = `${user.id}/${captureId}.jpg`;

      await uploadImageToStorage(args.localImageUri, storagePath);

      const { localImageUri: _ignored, ...serviceInput } = args;
      const result = await createCapture({
        ...serviceInput,
        image_storage_key: storagePath,
      });

      return unwrap(result);
    },
    onSuccess: () => {
      // Invalidate all capture list queries for the current user.
      queryClient.invalidateQueries({ queryKey: ['captures'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useCaptureImageUrl
// ---------------------------------------------------------------------------

/**
 * Returns a short-TTL signed URL for a capture's private Storage object.
 * The query is disabled when image_path is null.
 * staleTime is set to (TTL - 30 s) so the URL is refreshed before expiry.
 */
export function useCaptureImageUrl(
  image_path: string | null
): UseQueryResult<string, Error> {
  return useQuery<string, Error>({
    queryKey: ['captureImageUrl', image_path],
    queryFn: async () => {
      // Enabled guard ensures image_path is non-null when this runs.
      const result = await signCaptureImageUrl(image_path as string);
      return unwrap(result);
    },
    enabled: image_path !== null,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: GC_TIME,
  });
}

// ---------------------------------------------------------------------------
// Internal: storage upload helper
// ---------------------------------------------------------------------------

/**
 * Uploads a local image URI to Supabase Storage.
 * Uses fetch() to resolve the local URI to a Blob, then uploads as JPEG.
 *
 * Note: hooks/ may import lib/supabase directly only for storage operations
 * that have no service abstraction yet (storage upload is part of the
 * useCreateCapture flow, not a standalone service fn per the task spec).
 */
async function uploadImageToStorage(
  localUri: string,
  storagePath: string
): Promise<void> {
  const response = await fetch(localUri);
  if (!response.ok) {
    throw new Error(`uploadImageToStorage: failed to fetch local URI (${response.status})`);
  }

  const blob = await response.blob();

  const { error } = await supabase.storage
    .from(CAPTURES_BUCKET)
    .upload(storagePath, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw new Error(`uploadImageToStorage: ${error.message}`);
  }
}

'use client';
/**
 * hooks/useProfile.ts — Profile data hooks (R3.4)
 *
 * Dependency rules (spec/architecture.md §2, §9):
 *   imports allowed: lib/AuthContext, lib/supabase, engine/types, @tanstack/react-query
 *   imports forbidden: app/, components/
 *
 * useProfile()       — convenience accessor over AuthContext; no extra network call.
 * useUpdateProfile() — mutation for profiles.display_name (the only client-writable
 *                      field per spec/data-model.md §2.1 RLS policy).
 *
 * NOTE: useMyFriendCode() is intentionally absent — that lives in useFriends (R3.3).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, type Profile } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Query key
// ---------------------------------------------------------------------------

/** Stable query key used to invalidate the profile cache after mutations. */
export const PROFILE_QUERY_KEY = ['profile'] as const;

// ---------------------------------------------------------------------------
// useProfile
// ---------------------------------------------------------------------------

export type UseProfileResult = {
  /** The profiles row for the signed-in user. Null while loading or signed out. */
  profile: Profile | null;
  /** True only during initial session resolution on mount. */
  isLoading: boolean;
  /**
   * Triggers a fresh profile fetch by calling supabase.auth.getSession(), which
   * causes AuthContext's onAuthStateChange listener to re-run fetchProfile.
   * This is intentionally lightweight — no React Query cache is involved for
   * the identity layer (AuthContext owns it per spec/architecture.md §5).
   *
   * TODO(R6): replace with a telemetry-instrumented wrapper.
   */
  refetch: () => Promise<void>;
};

/**
 * Returns the current user's profile from AuthContext.
 * Must be called inside <AuthProvider> (enforced by useAuth()).
 *
 * Prefer this over calling useAuth() directly in screens — it narrows the
 * surface and makes the intent explicit.
 */
export function useProfile(): UseProfileResult {
  const { profile, isLoading } = useAuth();

  const refetch = async (): Promise<void> => {
    // Refreshing the Supabase session triggers onAuthStateChange, which calls
    // fetchProfile inside AuthProvider — no duplicate fetch logic here.
    await supabase.auth.getSession();
  };

  return { profile, isLoading, refetch };
}

// ---------------------------------------------------------------------------
// useUpdateProfile
// ---------------------------------------------------------------------------

export type UpdateProfileInput = {
  /** The only client-updatable field per data-model.md §2.1 and RLS policy. */
  display_name: string | null;
};

export type UpdateProfileError = Error;

/**
 * Mutation hook to update the current user's display_name.
 *
 * On success:
 *   - Invalidates PROFILE_QUERY_KEY so any React Query consumers re-fetch.
 *   - Does NOT force-refresh AuthContext profile — AuthContext will pick up
 *     the new value on the next auth event or page reload. If immediate
 *     reflection is required, call refetch() from useProfile() after mutation.
 *
 * On error:
 *   - Returns a typed Error. Screens should render error.message.
 *   - Never throws — React Query surfaces it via mutation.error.
 *
 * Usage:
 *   const { mutate, isPending, error } = useUpdateProfile();
 *   mutate({ display_name: 'WildHunter99' });
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation<Profile, UpdateProfileError, UpdateProfileInput>({
    mutationFn: async (input) => {
      if (!user) {
        throw new Error('useUpdateProfile: no authenticated user');
      }

      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: input.display_name })
        .eq('user_id', user.id)
        .select(
          'user_id, friend_code, display_name, is_pro, pro_until, created_at, updated_at',
        )
        .single();

      if (error) {
        throw new Error(`useUpdateProfile: ${error.message}`);
      }

      if (!data) {
        throw new Error('useUpdateProfile: no row returned after update');
      }

      return data as Profile;
    },
    onSuccess: () => {
      // Invalidate any React Query consumers that depend on the profile key.
      // AuthContext is not React Query-managed, so it updates on next auth event.
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}

'use client';
/**
 * lib/AuthContext.tsx — React Context for auth identity (Infra layer)
 *
 * Pattern (spec/architecture.md §5):
 *   - Calls getSession() ONCE on mount — no per-screen getUser() network calls.
 *   - Subscribes to onAuthStateChange for the lifetime of the provider.
 *   - Exposes { session, user, profile, isLoading, signOut } to all consumers.
 *
 * AuthProvider is intentionally NOT added to any layout here — that is R5's job.
 *
 * Dependency direction: lib/ may NOT import from hooks/, services/, app/, components/.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getSession, onAuthStateChange, signOut as authSignOut } from './auth';

// ---------------------------------------------------------------------------
// Profile type
// Minimal shape matching data-model.md §2.1 profiles table.
// TODO(R3): replace with the generated Supabase DB type once available.
// ---------------------------------------------------------------------------

export type Profile = {
  user_id: string;
  friend_code: string;
  display_name: string | null;
  is_pro: boolean;
  pro_until: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export type AuthContextValue = {
  /** The raw Supabase session. Null when signed out or still loading. */
  session: Session | null;
  /** Convenience alias for session.user. Null when signed out or loading. */
  user: User | null;
  /** The profiles row for the current user. Null when signed out/loading or not yet fetched. */
  profile: Profile | null;
  /** True only during the initial session resolution on mount. */
  isLoading: boolean;
  /** Calls supabase signOut and clears context state. Returns the result. */
  signOut: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

type AuthProviderProps = { children: React.ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch the profile row for a given user id. Best-effort — a missing profile
  // row (e.g. trigger not yet run) is non-fatal; profile stays null.
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, friend_code, display_name, is_pro, pro_until, created_at, updated_at')
      .eq('user_id', userId)
      .single();
    if (error || !data) {
      setProfile(null);
      return;
    }
    setProfile(data as Profile);
  }, []);

  // Single session resolution on mount.
  useEffect(() => {
    let cancelled = false;

    async function resolveSession() {
      const result = await getSession();
      if (cancelled) return;

      if (result.ok && result.data) {
        setSession(result.data);
        await fetchProfile(result.data.user.id);
      } else {
        setSession(null);
        setProfile(null);
      }
      setIsLoading(false);
    }

    resolveSession();

    // Subscribe for the provider lifetime.
    const subscription = onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession?.user) {
        fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
      // After the first onAuthStateChange fires, loading is definitely done.
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const handleSignOut = useCallback(async () => {
    await authSignOut();
    // State is cleared by the onAuthStateChange listener (session → null).
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    isLoading,
    signOut: handleSignOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// useAuth hook
// ---------------------------------------------------------------------------

/**
 * Returns the current auth context. Throws a descriptive error when called
 * outside of <AuthProvider> — fail-fast rather than silently returning null.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error(
      'useAuth() must be called inside an <AuthProvider>. ' +
        'Wrap your root layout with <AuthProvider> (done in R5, app/_layout.tsx).',
    );
  }
  return ctx;
}

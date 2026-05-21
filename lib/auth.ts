/**
 * lib/auth.ts — Supabase auth wrapper (Infra layer)
 *
 * Thin, type-safe wrapper over supabase-js v2 auth.
 * Every function returns a discriminated union — no thrown errors.
 *
 * Dependency direction: lib/ may NOT import from hooks/, services/, app/, components/.
 * Consumers: services/authService.ts (and, temporarily, lib/AuthContext.tsx during R1-R5).
 */

import { Platform } from 'react-native';
import type { AuthChangeEvent, Session, Subscription } from '@supabase/supabase-js';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: Error };

// ---------------------------------------------------------------------------
// Redirect helpers (internal — not exported; same logic as old lib/auth.ts)
// ---------------------------------------------------------------------------

const NATIVE_REDIRECT = 'wildex://';

function webRedirect(): string {
  const env = process.env.EXPO_PUBLIC_REDIRECT_URL_WEB;
  if (env) return env;
  if (typeof window !== 'undefined') return window.location.origin;
  return NATIVE_REDIRECT;
}

// ---------------------------------------------------------------------------
// signInWithEmail
// ---------------------------------------------------------------------------

export type SignInWithEmailInput = { email: string };

export async function signInWithEmail(
  input: SignInWithEmailInput,
): Promise<AuthResult<null>> {
  const { error } = await supabase.auth.signInWithOtp({
    email: input.email,
    options: {
      emailRedirectTo: Platform.OS === 'web' ? webRedirect() : NATIVE_REDIRECT,
    },
  });
  if (error) return { ok: false, error };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// signInWithApple  (iOS only)
// ---------------------------------------------------------------------------

export async function signInWithApple(): Promise<AuthResult<Session>> {
  if (Platform.OS !== 'ios') {
    return { ok: false, error: new Error('Apple Sign In is only available on iOS') };
  }

  let AppleAuthentication: typeof import('expo-apple-authentication');
  let Crypto: typeof import('expo-crypto');
  try {
    [AppleAuthentication, Crypto] = await Promise.all([
      import('expo-apple-authentication'),
      import('expo-crypto'),
    ]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  let credential: Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  if (!credential.identityToken) {
    return { ok: false, error: new Error('No identity token from Apple') };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) return { ok: false, error };
  if (!data.session) return { ok: false, error: new Error('No session returned') };
  return { ok: true, data: data.session };
}

// ---------------------------------------------------------------------------
// signInWithGoogle
// ---------------------------------------------------------------------------

export async function signInWithGoogle(): Promise<AuthResult<null>> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: webRedirect() },
    });
    if (error) return { ok: false, error };
    return { ok: true, data: null };
  }

  let WebBrowser: typeof import('expo-web-browser');
  try {
    WebBrowser = await import('expo-web-browser');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) return { ok: false, error };
  if (!data?.url) return { ok: false, error: new Error('No OAuth URL returned by Supabase') };

  const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_REDIRECT);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { ok: true, data: null }; // user cancelled — not an error
  }
  if (result.type !== 'success' || !result.url) {
    return { ok: false, error: new Error(`Google sign-in failed: ${result.type}`) };
  }

  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, error: new Error('OAuth redirect missing `code` param') };

  const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exErr) return { ok: false, error: exErr };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

export async function signOut(): Promise<AuthResult<null>> {
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

export async function getSession(): Promise<AuthResult<Session | null>> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return { ok: false, error };
  return { ok: true, data: data.session };
}

// ---------------------------------------------------------------------------
// onAuthStateChange
// ---------------------------------------------------------------------------

export type AuthStateChangeCallback = (
  event: AuthChangeEvent,
  session: Session | null,
) => void;

export function onAuthStateChange(callback: AuthStateChangeCallback): Subscription {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return data.subscription;
}

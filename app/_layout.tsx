'use client';
/**
 * app/_layout.tsx — Root layout (R5.8)
 *
 * Provider order (outermost → innermost):
 *   SafeAreaProvider → QueryClientProvider → AuthProvider → Stack
 *
 * Dependency direction (spec/architecture.md §2, §9):
 *   app/ may import from: hooks/, components/, lib/ (AuthContext, queryClient)
 *   app/ may NOT import from: services/, lib/supabase.ts directly
 *
 * TODO(R6): install @tanstack/react-query — `npx expo install @tanstack/react-query`
 *           Until installed this file will fail to compile.
 * TODO(R6): install expo-splash-screen — `npx expo install expo-splash-screen`
 *           Until installed the SplashScreen.* calls below will fail.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen'; // TODO(R6): npx expo install expo-splash-screen
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query'; // TODO(R6): npx expo install @tanstack/react-query

import { AuthProvider, useAuth } from '../lib/AuthContext';
import { createQueryClient } from '../lib/queryClient';
import { colors } from '../components/theme';

// ---------------------------------------------------------------------------
// Keep the splash screen visible until we explicitly hide it.
// Must be called before any awaitable — before the first render.
// TODO(R6): remove this guard once expo-splash-screen is installed.
// ---------------------------------------------------------------------------

if (SplashScreen?.preventAutoHideAsync) {
  SplashScreen.preventAutoHideAsync().catch(() => {
    // Non-fatal: splash screen may already have been hidden (web).
  });
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Wildex crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.bg.canvas, padding: 20 }}
        >
          <Text
            style={{
              color: colors.status.error,
              fontSize: 18,
              fontWeight: 'bold',
              marginBottom: 8,
            }}
          >
            App crashed
          </Text>
          <Text style={{ color: colors.text.primary, fontFamily: monoFont }}>
            {String(this.state.error?.message ?? this.state.error)}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontFamily: monoFont,
              marginTop: 16,
              fontSize: 11,
            }}
          >
            {String(this.state.error?.stack ?? '')}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Web-only global error listener (auto-dismisses after 10 s)
// ---------------------------------------------------------------------------

function GlobalErrorListener() {
  const [err, setErr] = React.useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onErr = (e: ErrorEvent) =>
      setErr(`${e.message}\n${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) =>
      setErr(
        `Unhandled rejection: ${String(
          (e.reason as { message?: string } | undefined)?.message ?? e.reason,
        )}`,
      );

    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  // Auto-dismiss transient errors after 10 s so they don't linger.
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(null), 10_000);
    return () => clearTimeout(t);
  }, [err]);

  if (!err) return null;

  return (
    <Pressable
      onPress={() => setErr(null)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: '#7a1414',
        padding: 12,
        zIndex: 9999,
      }}
    >
      <Text style={{ color: '#fff', fontFamily: monoFont, fontSize: 11 }}>
        {err}
      </Text>
      <Text
        style={{
          color: '#fff',
          fontFamily: monoFont,
          fontSize: 9,
          marginTop: 2,
          opacity: 0.7,
        }}
      >
        tap to dismiss · auto-clears in 10s
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Auth guard
//
// Expo Router has no built-in middleware for native. We use a useEffect inside
// the auth-aware inner layout to redirect unauthenticated users to sign-in.
// This component must be rendered INSIDE AuthProvider so useAuth() works.
// ---------------------------------------------------------------------------

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return; // wait until session is resolved

    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      // Not authenticated and not already on an auth screen → redirect.
      router.replace('/(auth)/sign-in');
    }
  }, [session, isLoading, segments, router]);

  // While loading show nothing — splash screen is still visible.
  if (isLoading) return null;

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Splash screen hide — called once auth + fonts are resolved.
// Rendered inside AuthProvider so it can read isLoading.
// ---------------------------------------------------------------------------

function SplashHider() {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    // TODO(R6): also await font loading here once custom fonts are added.
    SplashScreen.hideAsync().catch(() => {
      // Non-fatal on web where SplashScreen is a no-op.
    });
  }, [isLoading]);

  return null;
}

// ---------------------------------------------------------------------------
// Header options shared across screens
// ---------------------------------------------------------------------------

const defaultHeaderStyle = {
  backgroundColor: colors.bg.canvas,
} as const;

const defaultHeaderOptions = {
  headerStyle: defaultHeaderStyle,
  headerTintColor: colors.text.primary,
  headerTitleStyle: { color: colors.text.primary },
} as const;

// ---------------------------------------------------------------------------
// Inner layout — rendered inside all providers
// ---------------------------------------------------------------------------

function InnerLayout() {
  return (
    <>
      <SplashHider />
      <StatusBar style="light" />
      <GlobalErrorListener />

      <AuthGuard>
        <Stack>
          {/* (auth) group — full-screen auth flow, no header */}
          <Stack.Screen
            name="(auth)"
            options={{ headerShown: false }}
          />

          {/* Home hub */}
          <Stack.Screen
            name="index"
            options={{
              ...defaultHeaderOptions,
              title: 'Wildex',
              headerTitleAlign: 'center',
            }}
          />

          {/* Capture — full-screen camera flow */}
          <Stack.Screen
            name="capture"
            options={{ headerShown: false }}
          />

          {/* Dex — capture list */}
          <Stack.Screen
            name="dex"
            options={{ ...defaultHeaderOptions, title: 'Dex' }}
          />

          {/* Battle picker */}
          <Stack.Screen
            name="battle"
            options={{ ...defaultHeaderOptions, title: 'Battles' }}
          />

          {/* Single battle detail */}
          <Stack.Screen
            name="battle/[id]"
            options={{ ...defaultHeaderOptions, title: 'Battle' }}
          />

          {/* Friends */}
          <Stack.Screen
            name="friends"
            options={{ ...defaultHeaderOptions, title: 'Friends' }}
          />

          {/* Challenge detail */}
          <Stack.Screen
            name="challenge"
            options={{ ...defaultHeaderOptions, title: 'Challenge' }}
          />
        </Stack>
      </AuthGuard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stable QueryClient ref — created once per app lifetime, never re-created
// on re-renders (useRef ensures stability without useState overhead).
// ---------------------------------------------------------------------------

function RootLayoutProviders() {
  const queryClientRef = useRef(createQueryClient());

  return (
    <SafeAreaProvider>
      {/* TODO(R6): verify @tanstack/react-query v5 peer-dep compat with Expo 52 / React 18.3 */}
      <QueryClientProvider client={queryClientRef.current}>
        <AuthProvider>
          <InnerLayout />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <RootLayoutProviders />
    </ErrorBoundary>
  );
}

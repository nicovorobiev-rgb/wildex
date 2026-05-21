'use client';
/**
 * app/(auth)/_layout.tsx — Expo Router group layout for auth screens.
 *
 * Renders a header-less Stack with the canvas background colour.
 * Guards against already-authenticated users: if a session is already
 * present when this layout mounts, redirect immediately to '/' so the
 * root layout can route them to the home screen.
 *
 * Dependency direction: app/ may import from lib/, components/ only.
 */

import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../components/theme';

export default function AuthLayout() {
  const { user, isLoading } = useAuth();

  // While the session is resolving, render nothing — avoids a redirect flicker.
  if (isLoading) return null;

  // Already signed in: bounce to the authenticated root.
  if (user) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.canvas },
        animation: 'fade',
      }}
    />
  );
}

// Polyfill is resolved by Metro per-platform: ./polyfills.native.ts for
// iOS/Android (loads react-native-url-polyfill), ./polyfills.web.ts is a no-op
// so the polyfill is NEVER bundled for web (it breaks Safari otherwise).
import './polyfills';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url  = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  throw new Error(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and ' +
    'EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local (local dev) or in your ' +
    'Vercel project Environment Variables (deployed web). ' +
    'After setting them: re-run npm run web / redeploy.'
  );
}

// On native (iOS/Android), Supabase falls back to in-memory storage if no
// storage adapter is given, so persistSession silently no-ops and users get
// signed out on every cold start. Pass AsyncStorage explicitly on native;
// on web, Supabase's default localStorage adapter is fine (don't override).
export const supabase = createClient(url, anon, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

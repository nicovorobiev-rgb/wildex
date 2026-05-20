// Polyfill is resolved by Metro per-platform: ./polyfills.native.ts for
// iOS/Android (loads react-native-url-polyfill), ./polyfills.web.ts is a
// no-op so the polyfill is NEVER bundled for web. Safari rejects the
// polyfill's monkey-patch of the native URL constructor with "Cannot set
// indexed properties on this object", which the previous runtime guard
// (if Platform.OS !== 'web') did NOT prevent — Metro still pulled the
// polyfill into the web bundle and its side-effect import ran on load.
import './polyfills';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// The URL polyfill is needed in React Native (no native URL impl) but
// breaks Safari, which throws "Cannot set indexed properties" when the
// polyfill tries to monkey-patch its native URL object.
if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { initIAP } from '../lib/iap';
import { supabase } from '../lib/supabase';

export default function RootLayout() {
  useEffect(() => {
    const key = process.env.EXPO_PUBLIC_RC_API_KEY;
    if (!key) return;
    supabase.auth.getUser().then(({ data }) => initIAP(key, data.user?.id).catch(() => {}));
  }, []);
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0b1d12' },
          headerTintColor: '#e7f5ec',
          contentStyle: { backgroundColor: '#0b1d12' },
        }}
      />
    </>
  );
}

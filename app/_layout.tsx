import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
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

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Wildex crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#0b1d12', padding: 20 }}>
          <Text style={{ color: '#ff6b6b', fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>
            App crashed
          </Text>
          <Text style={{ color: '#e7f5ec', fontFamily: 'monospace' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </Text>
          <Text style={{ color: '#9fb9aa', fontFamily: 'monospace', marginTop: 16, fontSize: 11 }}>
            {String(this.state.error?.stack ?? '')}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

function GlobalErrorListener() {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onErr = (e: ErrorEvent) => setErr(`${e.message}\n${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) => setErr(`Unhandled rejection: ${String(e.reason?.message ?? e.reason)}`);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);
  if (!err) return null;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#7a1414', padding: 12, zIndex: 9999 }}>
      <Text style={{ color: '#fff', fontFamily: 'monospace', fontSize: 11 }}>{err}</Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <GlobalErrorListener />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0b1d12' },
          headerTintColor: '#e7f5ec',
          contentStyle: { backgroundColor: '#0b1d12' },
        }}
      />
    </ErrorBoundary>
  );
}

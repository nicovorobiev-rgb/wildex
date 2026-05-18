import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { signInWithApple, signInWithEmail, signInWithGoogle } from '../lib/auth';

export default function SignIn() {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      import('expo-apple-authentication').then((m) => m.isAvailableAsync().then(setAppleAvailable));
    }
  }, []);

  async function sendLink() {
    if (!email) return;
    setBusy(true);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (e: any) {
      Alert.alert('Could not send link', String(e.message ?? e));
    } finally { setBusy(false); }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Wildex</Text>
      <Text style={styles.sub}>Sign in to start your dex</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        placeholderTextColor="#6b8579"
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <Pressable style={[styles.btn, (!email || busy) && styles.disabled]} disabled={!email || busy} onPress={sendLink}>
        <Text style={styles.btnText}>{sent ? 'Check your email' : busy ? 'Sending…' : 'Send magic link'}</Text>
      </Pressable>

      <Pressable
        style={styles.googleBtn}
        onPress={async () => {
          try { await signInWithGoogle(); }
          catch (e: any) { Alert.alert('Sign-in failed', String(e.message ?? e)); }
        }}
      >
        <Text style={styles.googleText}>Continue with Google</Text>
      </Pressable>

      {Platform.OS === 'ios' && appleAvailable && (
        <Pressable
          style={styles.appleBtn}
          onPress={async () => {
            try { await signInWithApple(); router.replace('/'); }
            catch (e: any) { if (e.code !== 'ERR_REQUEST_CANCELED') Alert.alert('Sign-in failed', String(e.message ?? e)); }
          }}
        >
          <Text style={styles.appleText}>  Sign in with Apple</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12, backgroundColor: '#0b1d12' },
  title: { color: '#7be39a', fontSize: 56, fontWeight: '800' },
  sub: { color: '#9fb9aa', marginBottom: 32 },
  input: { width: '100%', maxWidth: 360, backgroundColor: '#0f2418', color: '#e7f5ec', padding: 14, borderRadius: 10, fontSize: 16 },
  btn: { width: '100%', maxWidth: 360, backgroundColor: '#2bbd6a', padding: 14, borderRadius: 10, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700' },
  appleBtn: { width: '100%', maxWidth: 360, backgroundColor: '#fff', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  appleText: { color: '#000', fontWeight: '700' },
  googleBtn: { width: '100%', maxWidth: 360, backgroundColor: '#fff', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#d0d0d0' },
  googleText: { color: '#000', fontWeight: '700' },
});

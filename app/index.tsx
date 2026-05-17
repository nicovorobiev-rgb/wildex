import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { signOut } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.replace('/sign-in');
      else setEmail(user.email ?? 'signed in');
    })();
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Wildex</Text>
      <Text style={styles.sub}>Photograph wild animals. Build your dex. Battle.</Text>

      <Link href="/capture" asChild>
        <Pressable style={[styles.btn, styles.primary]}>
          <Text style={styles.btnText}>Capture</Text>
        </Pressable>
      </Link>
      <Link href="/dex" asChild>
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>My Dex</Text>
        </Pressable>
      </Link>
      <Link href="/grow" asChild>
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>Grow & Feed</Text>
        </Pressable>
      </Link>
      <Link href="/battle" asChild>
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>Local Battle</Text>
        </Pressable>
      </Link>
      <Link href="/challenge" asChild>
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>Online Challenges</Text>
        </Pressable>
      </Link>

      {email && (
        <Pressable onPress={async () => { await signOut(); router.replace('/sign-in'); }}>
          <Text style={styles.signOut}>Sign out ({email})</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { color: '#7be39a', fontSize: 56, fontWeight: '800', letterSpacing: 1 },
  sub: { color: '#9fb9aa', fontSize: 14, marginBottom: 24, textAlign: 'center' },
  btn: { width: '100%', padding: 16, borderRadius: 12, backgroundColor: '#16321f', alignItems: 'center' },
  primary: { backgroundColor: '#2bbd6a' },
  btnText: { color: '#e7f5ec', fontSize: 16, fontWeight: '700' },
  signOut: { color: '#6b8579', marginTop: 24, fontSize: 12 },
});

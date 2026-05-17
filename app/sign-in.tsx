import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { signInWithApple } from '../lib/auth';

export default function SignIn() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Wildex</Text>
      <Text style={styles.sub}>Sign in to start your dex</Text>

      {available && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={12}
          style={styles.appleBtn}
          onPress={async () => {
            try {
              await signInWithApple();
              router.replace('/');
            } catch (e: any) {
              if (e.code !== 'ERR_REQUEST_CANCELED') Alert.alert('Sign-in failed', String(e.message ?? e));
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  title: { color: '#7be39a', fontSize: 56, fontWeight: '800' },
  sub: { color: '#9fb9aa', marginBottom: 32 },
  appleBtn: { width: '100%', height: 56 },
});

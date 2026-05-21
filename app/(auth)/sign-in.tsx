'use client';
/**
 * app/(auth)/sign-in.tsx — Wildex sign-in screen (v0.2)
 *
 * Layout (design-brief.md §6.5):
 *   WILDEX wordmark
 *   "Continue with Apple" (iOS only)
 *   "Continue with Google" (all platforms)
 *   ── or ──
 *   Email input + "Send magic link" → "Check your email" success state
 *   ToS caption
 *
 * Auth is handled by lib/auth.ts; session propagation by lib/AuthContext.tsx.
 * On successful sign-in the AuthContext emits a new session, the (auth)/_layout
 * detects user !== null and Redirects to '/'.
 *
 * Dependency direction: app/ may import from lib/, components/ only.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signInWithApple, signInWithEmail, signInWithGoogle } from '../../lib/auth';
import { Button } from '../../components/Button';
import Screen from '../../components/Screen';
import { colors, radius, space, typography } from '../../components/theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 30;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Wordmark() {
  return (
    <View style={styles.wordmarkWrap}>
      <Text style={styles.wordmark}>WILDEX</Text>
      <Text style={styles.tagline}>Sign in to save captures</Text>
    </View>
  );
}

function OrDivider() {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>or</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

type InlineErrorProps = { message: string };
function InlineError({ message }: InlineErrorProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [message, opacity]);

  return (
    <Animated.Text style={[styles.errorText, { opacity }]}>
      {message}
    </Animated.Text>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SignInScreen() {
  // Social button loading states
  const [appleLoading, setAppleLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Email section state
  const [email, setEmail]         = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [sent, setSent]           = useState(false);
  const [cooldown, setCooldown]   = useState(0);

  // Per-method error messages
  const [appleError, setAppleError]   = useState('');
  const [googleError, setGoogleError] = useState('');
  const [emailError, setEmailError]   = useState('');

  // Cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Derived
  const emailValid   = EMAIL_RE.test(email.trim());
  const emailDisabled = !emailValid || emailBusy || cooldown > 0;
  const anyBusy      = appleLoading || googleLoading || emailBusy;

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleApple() {
    setAppleError('');
    setAppleLoading(true);
    try {
      const result = await signInWithApple();
      if (!result.ok) {
        // ERR_CANCELED means the user dismissed the sheet — not an error.
        const msg = result.error.message ?? '';
        if (!msg.includes('canceled') && !msg.includes('ERR_REQUEST_CANCELED')) {
          setAppleError(result.error.message);
        }
      }
      // On success, AuthContext picks up the new session and _layout redirects.
    } finally {
      setAppleLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok) {
        setGoogleError(result.error.message);
      }
      // On success, AuthContext picks up the new session and _layout redirects.
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleEmail() {
    if (emailDisabled) return;
    setEmailError('');
    setEmailBusy(true);
    try {
      const result = await signInWithEmail({ email: email.trim() });
      if (!result.ok) {
        setEmailError(result.error.message);
        return;
      }
      setSent(true);
      setCooldown(COOLDOWN_SECONDS);
    } finally {
      setEmailBusy(false);
    }
  }

  // ── Email button label ───────────────────────────────────────────────────

  function emailButtonLabel(): string {
    if (cooldown > 0) return `Resend in ${cooldown}s`;
    if (sent)         return 'Check your email';
    return 'Send magic link';
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Screen scroll={false} padded>
      <View style={styles.inner}>
        <Wordmark />

        {/* ── Social buttons ─────────────────────────────────────────── */}
        <View style={styles.socialGroup}>
          {Platform.OS === 'ios' && (
            <View style={styles.buttonWrap}>
              <Button
                label="Continue with Apple"
                variant="secondary"
                size="lg"
                fullWidth
                loading={appleLoading}
                disabled={anyBusy && !appleLoading}
                onPress={handleApple}
              />
              {appleError ? <InlineError message={appleError} /> : null}
            </View>
          )}

          <View style={styles.buttonWrap}>
            <Button
              label="Continue with Google"
              variant="secondary"
              size="lg"
              fullWidth
              loading={googleLoading}
              disabled={anyBusy && !googleLoading}
              onPress={handleGoogle}
            />
            {googleError ? <InlineError message={googleError} /> : null}
          </View>
        </View>

        {/* ── Divider ────────────────────────────────────────────────── */}
        <OrDivider />

        {/* ── Email section ──────────────────────────────────────────── */}
        <View style={styles.emailGroup}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={[
              styles.input,
              emailError ? styles.inputError : null,
            ]}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setEmailError('');
              if (sent) setSent(false);
            }}
            placeholder="you@example.com"
            placeholderTextColor={colors.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={handleEmail}
            editable={!emailBusy}
          />

          {sent && !emailError && (
            <View style={styles.successRow}>
              <Text style={styles.successText}>
                Magic link sent — check your inbox.
              </Text>
            </View>
          )}

          {emailError ? <InlineError message={emailError} /> : null}

          <View style={styles.buttonWrap}>
            <Button
              label={emailButtonLabel()}
              variant="primary"
              size="lg"
              fullWidth
              loading={emailBusy}
              disabled={emailDisabled}
              onPress={handleEmail}
            />
          </View>
        </View>

        {/* ── ToS caption ────────────────────────────────────────────── */}
        <Text style={styles.tos}>
          By signing in you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  inner: {
    flex:            1,
    justifyContent:  'center',
    gap:             space[6],
  },

  // Wordmark
  wordmarkWrap: {
    alignItems: 'center',
    gap:        space[1],
    marginBottom: space[2],
  },
  wordmark: {
    color:        colors.text.accent,
    fontSize:     typography.size['2xl'],
    fontWeight:   typography.weight.heavy,
    letterSpacing: 4,
    lineHeight:   typography.size['2xl'] * typography.leading.tight,
  },
  tagline: {
    color:    colors.text.secondary,
    fontSize: typography.size.sm,
  },

  // Social
  socialGroup: {
    gap: space[3],
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           space[3],
  },
  dividerLine: {
    flex:        1,
    height:      1,
    backgroundColor: colors.border.subtle,
  },
  dividerLabel: {
    color:    colors.text.muted,
    fontSize: typography.size.sm,
  },

  // Email
  emailGroup: {
    gap: space[3],
  },
  fieldLabel: {
    color:      colors.text.secondary,
    fontSize:   typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  input: {
    backgroundColor: colors.bg.surface,
    color:           colors.text.primary,
    fontSize:        typography.size.base,
    borderRadius:    radius.md,
    borderWidth:     1,
    borderColor:     colors.border.default,
    paddingHorizontal: space[4],
    paddingVertical:   space[3],
    minHeight:       44,
  },
  inputError: {
    borderColor: colors.status.error,
  },

  // Success
  successRow: {
    backgroundColor: colors.bg.elevated,
    borderRadius:    radius.md,
    padding:         space[3],
  },
  successText: {
    color:    colors.status.success,
    fontSize: typography.size.sm,
  },

  // Error
  errorText: {
    color:    colors.status.error,
    fontSize: typography.size.sm,
    marginTop: -space[1],
  },

  // Wrappers
  buttonWrap: {
    gap: space[1],
  },

  // ToS
  tos: {
    color:     colors.text.muted,
    fontSize:  typography.size.xs,
    textAlign: 'center',
    lineHeight: typography.size.xs * typography.leading.loose,
    marginTop:  space[2],
  },
});

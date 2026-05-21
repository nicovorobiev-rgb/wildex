/**
 * app/index.tsx — Home screen (Wildex v0.2, R5.1)
 *
 * Auth-gated: redirects to /(auth)/sign-in when no session is present.
 * Displays dex summary, recent 5 captures, and the main 2×2 nav grid.
 *
 * Dependency rules (spec/architecture.md §9):
 *   imports allowed: react, react-native, expo-router, hooks/, components/, lib/AuthContext
 *   imports forbidden: services/, supabase, engine/ (direct)
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';

import Screen from '@/components/Screen';
import { Button } from '@/components/Button';
import { CaptureChip } from '@/components/CaptureChip';
import { colors, space, typography, radius } from '@/components/theme';
import { useAuth } from '@/lib/AuthContext';
import { useCaptures } from '@/hooks/useCaptures';
import type { Rarity } from '@/engine/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENT_LIMIT = 5;

/** Rarity ordering for "rarest tier" label, highest first. */
const RARITY_ORDER: Rarity[] = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rarestTier(rarities: Rarity[]): Rarity | null {
  for (const tier of RARITY_ORDER) {
    if (rarities.includes(tier)) return tier;
  }
  return null;
}

function rarityLabel(tier: Rarity | null): string {
  if (!tier) return 'None yet';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DexCountCardProps {
  total: number;
  rarest: Rarity | null;
}

function DexCountCard({ total, rarest }: DexCountCardProps): React.ReactElement {
  const rarityColor = rarest ? colors.rarity[rarest] : colors.text.muted;

  return (
    <View style={styles.dexCard}>
      <View style={styles.dexStat}>
        <Text style={styles.dexValue}>{total}</Text>
        <Text style={styles.dexLabel}>Captures</Text>
      </View>
      <View style={styles.dexDivider} />
      <View style={styles.dexStat}>
        <Text style={[styles.dexValue, { color: rarityColor }]}>
          {rarityLabel(rarest)}
        </Text>
        <Text style={styles.dexLabel}>Rarest</Text>
      </View>
    </View>
  );
}

interface NavTileProps {
  label: string;
  emoji: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}

function NavTile({ label, emoji, onPress, variant = 'secondary' }: NavTileProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.navTile,
        variant === 'primary' && styles.navTilePrimary,
        pressed && styles.navTilePressed,
      ]}
    >
      <Text style={styles.navTileEmoji}>{emoji}</Text>
      <Text style={[styles.navTileLabel, variant === 'primary' && styles.navTileLabelPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------

export default function HomeScreen(): React.ReactElement {
  const { user, profile, isLoading: authLoading, signOut } = useAuth();
  const router = useRouter();

  const { data: allCaptures, isLoading: capturesLoading } = useCaptures();
  const { data: recentCaptures } = useCaptures({ limit: RECENT_LIMIT });

  // Auth guard — wait for session resolution before redirecting.
  if (authLoading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.text.accent} size="large" />
        </View>
      </Screen>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  const displayName = profile?.display_name ?? 'naturalist';
  const totalCaptures = allCaptures?.length ?? 0;
  const rarities = allCaptures?.map((c) => c.stats.rarity) ?? [];
  const rarest = rarestTier(rarities);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/sign-in');
  };

  return (
    <Screen scroll padded>
      {/* Wordmark */}
      <Text style={styles.wordmark}>Wildex</Text>
      <Text style={styles.tagline}>Photograph. Collect. Battle.</Text>

      {/* Greeting */}
      <Text style={styles.greeting}>Welcome back, {displayName}</Text>

      {/* Dex count card */}
      {capturesLoading ? (
        <View style={styles.dexCardLoading}>
          <ActivityIndicator color={colors.text.accent} />
        </View>
      ) : (
        <DexCountCard total={totalCaptures} rarest={rarest} />
      )}

      {/* Recent captures */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Recent Captures</Text>

        {capturesLoading ? (
          <ActivityIndicator
            color={colors.text.accent}
            style={styles.sectionSpinner}
          />
        ) : recentCaptures && recentCaptures.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipList}
          >
            {recentCaptures.map((capture) => (
              <CaptureChip
                key={capture.id}
                capture={capture}
                onPress={() => router.push('/dex')}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No captures yet.</Text>
            <Button
              label="Take your first photo"
              variant="primary"
              onPress={() => router.push('/capture')}
            />
          </View>
        )}
      </View>

      {/* Main nav grid (2×2) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Quick Actions</Text>
        <View style={styles.navGrid}>
          <NavTile
            label="Capture"
            emoji="📷"
            variant="primary"
            onPress={() => router.push('/capture')}
          />
          <NavTile
            label="My Dex"
            emoji="📔"
            onPress={() => router.push('/dex')}
          />
          <NavTile
            label="Battle"
            emoji="⚔️"
            onPress={() => router.push('/battle')}
          />
          <NavTile
            label="Friends"
            emoji="🤝"
            onPress={() => router.push('/challenge')}
          />
        </View>
      </View>

      {/* Sign-out footer */}
      <View style={styles.footer}>
        <Text style={styles.footerEmail} numberOfLines={1}>
          Signed in as {user.email ?? 'unknown'}
        </Text>
        <Text style={styles.footerSep}> · </Text>
        <Pressable onPress={handleSignOut} accessibilityRole="button">
          <Text style={styles.footerSignOut}>out</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Wordmark
  wordmark: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size['2xl'],
    fontWeight:  typography.weight.heavy,
    color:       colors.text.accent,
    letterSpacing: 1,
    textAlign:   'center',
    marginTop:   space[4],
  },
  tagline: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.sm,
    fontWeight:  typography.weight.regular,
    color:       colors.text.secondary,
    textAlign:   'center',
    marginBottom: space[2],
  },

  // Greeting
  greeting: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.base,
    fontWeight:  typography.weight.medium,
    color:       colors.text.primary,
    textAlign:   'center',
    marginBottom: space[6],
  },

  // Dex count card
  dexCard: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-around',
    backgroundColor: colors.bg.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border.default,
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    marginBottom:    space[6],
  },
  dexCardLoading: {
    height:          80,
    backgroundColor: colors.bg.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border.subtle,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    space[6],
  },
  dexStat: {
    alignItems: 'center',
    gap:        space[1],
  },
  dexValue: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.xl,
    fontWeight:  typography.weight.bold,
    color:       colors.text.primary,
    lineHeight:  typography.size.xl * typography.leading.tight,
  },
  dexLabel: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.xs,
    fontWeight:  typography.weight.medium,
    color:       colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dexDivider: {
    width:  1,
    height: 40,
    backgroundColor: colors.border.subtle,
  },

  // Section
  section: {
    marginBottom: space[6],
  },
  sectionHeader: {
    fontFamily:    typography.family.sans,
    fontSize:      typography.size.xs,
    fontWeight:    typography.weight.medium,
    color:         colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom:  space[3],
  },
  sectionSpinner: {
    marginVertical: space[4],
  },

  // Recent captures
  chipList: {
    gap:          space[2],
    paddingRight: space[4],
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    gap:        space[3],
    paddingVertical: space[4],
  },
  emptyText: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.base,
    color:       colors.text.muted,
    lineHeight:  typography.size.base * typography.leading.loose,
  },

  // Nav grid
  navGrid: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            space[3],
  },
  navTile: {
    width:           '47%',
    aspectRatio:     1.4,
    backgroundColor: colors.bg.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border.default,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             space[1],
  },
  navTilePrimary: {
    backgroundColor: colors.brand.primary,
    borderColor:     colors.brand.primary,
  },
  navTilePressed: {
    opacity: 0.8,
  },
  navTileEmoji: {
    fontSize: 26,
  },
  navTileLabel: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.base,
    fontWeight:  typography.weight.medium,
    color:       colors.text.primary,
  },
  navTileLabelPrimary: {
    color: colors.text.inverse,
  },

  // Footer
  footer: {
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
    marginTop:      space[4],
    paddingBottom:  space[2],
  },
  footerEmail: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.xs,
    color:       colors.text.muted,
    flexShrink:  1,
  },
  footerSep: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.xs,
    color:       colors.text.muted,
  },
  footerSignOut: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.xs,
    color:       colors.text.muted,
    textDecorationLine: 'underline',
  },
});

// components/CaptureCard.tsx — Wildex v0.2
// Dex thumbnail card. Replaces the inline card JSX in app/dex.tsx.
// ElementChip and RarityBadge are written in parallel — imports resolve once those files land.

import React, { useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Capture } from '@/engine/types';
import { colors, radius, shadow, space, typography } from './theme';
import { ElementChip } from './ElementChip';
import { RarityBadge } from './RarityBadge';
import Card from './Card';

// ---------------------------------------------------------------------------
// Optional Expo Image — falls back to RN Image if expo-image is absent.
// ---------------------------------------------------------------------------
let ExpoImage: React.ComponentType<{
  source: { uri: string } | null;
  style: object;
  contentFit?: string;
  transition?: number;
}> | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ExpoImage = require('expo-image').Image;
} catch {
  ExpoImage = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaptureCardProps {
  capture: Capture;
  /** Signed URL for the capture photo. Caller obtains via useCaptureImageUrl(). */
  imageUrl?: string | null;
  onPress?: () => void;
  /** Compact removes scientific name + stat preview; image becomes 1:1. */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rarityBorderColor(rarity: Capture['stats']['rarity']): string {
  return hexToRgba(colors.rarity[rarity], 0.4);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CaptureImageProps {
  uri: string | null | undefined;
  compact: boolean;
}

function CaptureImage({ uri, compact }: CaptureImageProps): React.ReactElement {
  const imageStyle = compact ? styles.imageCompact : styles.imageNormal;

  if (uri) {
    if (ExpoImage) {
      return (
        <ExpoImage
          source={{ uri }}
          style={imageStyle}
          contentFit="cover"
          transition={200}
        />
      );
    }
    return <Image source={{ uri }} style={imageStyle} resizeMode="cover" />;
  }

  return <View style={[imageStyle, styles.imagePlaceholder]} />;
}

// ---------------------------------------------------------------------------
// CaptureCard
// ---------------------------------------------------------------------------

export default function CaptureCard({
  capture,
  imageUrl,
  onPress,
  compact = false,
}: CaptureCardProps): React.ReactElement {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePressIn(): void {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }

  function handlePressOut(): void {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 2,
    }).start();
  }

  const borderColor = rarityBorderColor(capture.stats.rarity);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={`${capture.common_name}, ${capture.stats.rarity}`}
    >
      <Animated.View
        style={[
          styles.animatedWrapper,
          { transform: [{ scale }] },
        ]}
      >
        <Card variant="surface" padding={0}>
          <View style={[styles.inner, { borderColor, borderWidth: 2 }]}>
            <CaptureImage uri={imageUrl} compact={compact} />

            <View style={styles.body}>
              <Text
                style={compact ? styles.nameCompact : styles.name}
                numberOfLines={1}
              >
                {capture.common_name}
              </Text>

              {!compact && (
                <Text style={styles.scientific} numberOfLines={1}>
                  {capture.scientific_name}
                </Text>
              )}

              <View style={styles.chips}>
                <ElementChip element={capture.stats.element} size="sm" />
                <RarityBadge rarity={capture.stats.rarity} />
              </View>
            </View>
          </View>
        </Card>
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  animatedWrapper: {
    ...shadow.card,
  },

  inner: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },

  // Image — 4:3 normal, 1:1 compact
  imageNormal: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    backgroundColor: colors.bg.surfaceAlt,
  },
  imageCompact: {
    width: '100%',
    aspectRatio: 1,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    backgroundColor: colors.bg.surfaceAlt,
  },
  imagePlaceholder: {
    backgroundColor: colors.bg.surfaceAlt,
  },

  body: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[4],
    gap: space[1],
  },

  name: {
    color: colors.text.primary,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    lineHeight: typography.size.lg * typography.leading.tight,
  },
  nameCompact: {
    color: colors.text.primary,
    fontSize: typography.size.base,
    fontWeight: typography.weight.bold,
    lineHeight: typography.size.base * typography.leading.tight,
  },

  scientific: {
    color: colors.text.secondary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.regular,
    fontStyle: 'italic',
    lineHeight: typography.size.sm * typography.leading.normal,
  },

  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[2],
  },
});

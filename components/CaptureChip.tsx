import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, shadow, space, typography } from './theme';
import { ElementChip } from './ElementChip';
import type { Capture } from '@/engine/types';

// Graceful optional import of expo-haptics — may not be installed.
let impactAsync: ((style: string) => Promise<void>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Haptics = require('expo-haptics');
  impactAsync = Haptics.impactAsync;
} catch {
  // expo-haptics not available — haptics silently disabled.
}

export interface CaptureChipProps {
  capture:   Capture;
  imageUrl?: string | null;
  selected?: boolean;
  onPress?:  () => void;
}

export function CaptureChip({
  capture,
  imageUrl,
  selected = false,
  onPress,
}: CaptureChipProps): React.ReactElement {
  async function handlePress() {
    if (!onPress) return;
    if (impactAsync) {
      try { await impactAsync('light'); } catch { /* ignore */ }
    }
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.container,
        selected && styles.containerSelected,
        pressed && styles.containerPressed,
      ]}
    >
      {/* Thumbnail */}
      <View style={styles.thumbWrap}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.thumb}
            resizeMode="cover"
            accessibilityLabel={capture.common_name}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
      </View>

      {/* Name + element */}
      <View style={styles.info}>
        <Text style={styles.commonName} numberOfLines={1}>
          {capture.common_name}
        </Text>
        <ElementChip element={capture.stats.element} size="sm" />
      </View>
    </Pressable>
  );
}

const THUMB_SIZE = 40;

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: colors.bg.surface,
    borderRadius:    radius.md,
    borderWidth:     2,
    borderColor:     colors.border.subtle,
    paddingVertical:   space[2],
    paddingHorizontal: space[2],
    gap:             space[2],
    ...shadow.card,
  },
  containerSelected: {
    borderColor:   colors.border.focus,
    ...shadow.glow,
  },
  containerPressed: {
    opacity: 0.85,
  },
  thumbWrap: {
    width:        THUMB_SIZE,
    height:       THUMB_SIZE,
    borderRadius: radius.sm,
    overflow:     'hidden',
  },
  thumb: {
    width:        THUMB_SIZE,
    height:       THUMB_SIZE,
    borderRadius: radius.sm,
  },
  thumbPlaceholder: {
    backgroundColor: colors.bg.elevated,
  },
  info: {
    flex:    1,
    gap:     space[1],
    minWidth: 0,
  },
  commonName: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.sm,
    fontWeight:  typography.weight.medium,
    color:       colors.text.primary,
    lineHeight:  typography.size.sm * typography.leading.tight,
  },
});

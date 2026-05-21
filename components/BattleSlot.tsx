import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, space, typography } from './theme';
import Card from './Card';
import { ElementChip } from './ElementChip';
import HPBar from './HPBar';
import type { Capture } from '@/engine/types';

export interface BattleSlotProps {
  capture: Capture;
  imageUrl?: string | null;
  currentHp: number;
  isAttacker?: boolean;
  isPlayer?: boolean;
}

export default function BattleSlot({
  capture,
  imageUrl,
  currentHp,
  isAttacker = false,
  isPlayer = false,
}: BattleSlotProps): React.ReactElement {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isAttacker) {
      glowAnim.setValue(0);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isAttacker, glowAnim]);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });

  const positionStyle = isPlayer ? styles.anchorPlayer : styles.anchorOpponent;

  return (
    <Animated.View
      style={[
        styles.container,
        positionStyle,
        isAttacker && {
          opacity: glowOpacity,
          ...shadow.glow,
        },
      ]}
    >
      <Card variant="elevated" padding={3}>
        <View style={styles.imageContainer}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]} />
          )}
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {capture.common_name}
          </Text>
          <ElementChip element={capture.stats.element} size="sm" />
        </View>

        <HPBar
          current={currentHp}
          max={capture.stats.hp}
          label="HP"
          height={8}
        />
      </Card>
    </Animated.View>
  );
}

const SLOT_WIDTH = 160;

const styles = StyleSheet.create({
  container: {
    width: SLOT_WIDTH,
    position: 'absolute',
  },
  anchorPlayer: {
    bottom: space[4],
    left: space[4],
  },
  anchorOpponent: {
    top: space[4],
    right: space[4],
  },
  imageContainer: {
    marginBottom: space[2],
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surfaceAlt,
  },
  imagePlaceholder: {
    backgroundColor: colors.bg.surfaceAlt,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[2],
    gap: space[1],
  },
  name: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
  },
});

import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, typography } from './theme';
import type { Rarity } from './theme';

type Size = 'sm' | 'md';

interface RarityBadgeProps {
  rarity: Rarity;
  size?: Size;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function RarityBadge({ rarity, size = 'md' }: RarityBadgeProps): React.ReactElement {
  const rarityColor = colors.rarity[rarity];
  const bgColor = hexToRgba(rarityColor, 0.2);
  const isSm = size === 'sm';
  const isLegendary = rarity === 'legendary';

  const glowStyle = isLegendary && Platform.OS === 'ios'
    ? {
        shadowColor: rarityColor,
        shadowOpacity: shadow.glow.shadowOpacity,
        shadowOffset: shadow.glow.shadowOffset,
        shadowRadius: shadow.glow.shadowRadius,
      }
    : undefined;

  const containerStyle = [
    styles.base,
    { backgroundColor: bgColor },
    isSm ? styles.containerSm : styles.containerMd,
    glowStyle,
  ];

  const textStyle = [
    styles.label,
    { color: rarityColor },
    isSm ? styles.textSm : styles.textMd,
  ];

  const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);

  return (
    <View style={containerStyle}>
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  containerMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  containerSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  label: {
    fontFamily: typography.family.sans,
    fontWeight: typography.weight.medium,
  },
  textMd: {
    fontSize: typography.size.sm,
  },
  textSm: {
    fontSize: typography.size.xs,
  },
});

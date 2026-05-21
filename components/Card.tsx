import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, shadow, space } from './theme';

export type CardVariant = 'surface' | 'elevated';
export type CardTone = 'default' | 'subtle' | 'accent';
export type CardPadding = keyof typeof space;

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  padding?: CardPadding;
  tone?: CardTone;
}

const BG: Record<CardVariant, string> = {
  surface:  colors.bg.surface,
  elevated: colors.bg.elevated,
};

export default function Card({
  children,
  variant = 'surface',
  padding = 4,
  tone = 'default',
}: CardProps): React.ReactElement {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: BG[variant], padding: space[padding] },
        tone === 'accent' && styles.accentBorder,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    ...shadow.card,
  },
  accentBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.brand.primary,
  },
});

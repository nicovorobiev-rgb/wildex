import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, typography } from './theme';
import type { Element } from './theme';

type Size = 'sm' | 'md';

interface ElementChipProps {
  element: Element;
  size?: Size;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function ElementChip({ element, size = 'md' }: ElementChipProps): React.ReactElement {
  const elementColor = colors.element[element];
  const bgColor = hexToRgba(elementColor, 0.2);
  const isSm = size === 'sm';

  const containerStyle = [
    styles.base,
    { backgroundColor: bgColor },
    isSm ? styles.containerSm : styles.containerMd,
  ];

  const textStyle = [
    styles.label,
    { color: elementColor },
    isSm ? styles.textSm : styles.textMd,
  ];

  const label = element.charAt(0).toUpperCase() + element.slice(1);

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

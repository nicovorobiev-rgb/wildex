import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radius, typography } from './theme';

export interface HPBarProps {
  current: number;
  max: number;
  label?: string;
  height?: number;
}

function hpColor(pct: number): string {
  if (pct > 0.5) return colors.status.success;
  if (pct >= 0.25) return colors.status.warning;
  return colors.status.error;
}

export default function HPBar({
  current,
  max,
  label,
  height = 10,
}: HPBarProps): React.ReactElement {
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const widthAnim = useRef(new Animated.Value(pct)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [pct, widthAnim]);

  const barColor = hpColor(pct);

  const animatedWidth = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.wrapper}>
      {label !== undefined && (
        <Text style={styles.label}>{label}</Text>
      )}
      <View style={[styles.track, { height }]}>
        <Animated.View
          style={[
            styles.fill,
            { width: animatedWidth, height, backgroundColor: barColor },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.text.secondary,
    marginBottom: 4,
  },
  track: {
    width: '100%',
    backgroundColor: colors.bg.elevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: radius.pill,
  },
});

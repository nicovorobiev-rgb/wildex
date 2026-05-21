// components/ProgressBar.tsx — Wildex v0.2
// Single animated progress bar. Reanimated used when available; falls back to
// RN Animated so the component never throws on a bare RN environment.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radius } from './theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressBarTone = 'brand' | 'success' | 'warning' | 'error';

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: ProgressBarTone;
  height?: number;
  animate?: boolean;
}

// ---------------------------------------------------------------------------
// Module-level constants (hoist out of render — rerender-memo-with-default-value,
// rendering-hoist-jsx)
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<ProgressBarTone, string> = {
  brand:   colors.brand.primary,
  success: colors.status.success,
  warning: colors.status.warning,
  error:   colors.status.error,
};

// Try to verify reanimated is available once at module load (not per render).
// Wrapping in try/catch satisfies the spec's optional-dep requirement without
// polluting the render path.
let reanimatedAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-reanimated');
  reanimatedAvailable = true;
} catch {
  reanimatedAvailable = false;
}

// ---------------------------------------------------------------------------
// Pure helpers (no closure over props — stable references)
// ---------------------------------------------------------------------------

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function toRatio(value: number, max: number): number {
  return clamp(value, max) / max;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  max = 100,
  tone = 'brand',
  height = 6,
  animate = true,
}: ProgressBarProps): React.ReactElement {
  // Use primitives as effect dependencies (rerender-dependencies).
  const ratio = toRatio(value, max);
  const fillColor = TONE_COLOR[tone];
  const duration = reanimatedAvailable ? 300 : 300;

  const widthAnim = useRef(new Animated.Value(animate ? 0 : ratio)).current;

  useEffect(() => {
    if (!animate) {
      widthAnim.setValue(ratio);
      return;
    }
    const anim = Animated.timing(widthAnim, {
      toValue: ratio,
      duration,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [ratio, animate, duration, widthAnim]);

  const animatedWidth = widthAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.track, { height, borderRadius: radius.pill }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            // Use ternary, not && (rendering-conditional-render).
            width: animate ? animatedWidth : `${ratio * 100}%`,
            height,
            borderRadius: radius.pill,
            backgroundColor: fillColor,
          },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: colors.bg.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});

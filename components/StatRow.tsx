// components/StatRow.tsx — Wildex v0.2
// Horizontal stat strip: label (left) + value (right) + ProgressBar below.
// Typography: label xs/medium text.secondary; value base/bold text.primary.
// Vertical padding: 12 pt (space.3).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ProgressBar, ProgressBarTone } from './ProgressBar';
import { colors, space, typography } from './theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatRowProps {
  label: string;
  value: number;
  max?: number;
  tone?: ProgressBarTone;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatRow({
  label,
  value,
  max = 200,
  tone,
}: StatRowProps): React.ReactElement {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      <ProgressBar value={value} max={max} tone={tone} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    paddingVertical: space[3],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space[1],
  },
  label: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.text.secondary,
  },
  value: {
    fontSize: typography.size.base,
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
  },
});

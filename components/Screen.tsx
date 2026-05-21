import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from './theme';

export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: ScreenEdge[];
  padded?: boolean;
  backgroundColor?: string;
}

const DEFAULT_EDGES: ScreenEdge[] = ['top', 'bottom', 'left', 'right'];

export default function Screen({
  children,
  scroll = true,
  edges = DEFAULT_EDGES,
  padded = true,
  backgroundColor = colors.bg.canvas,
}: ScreenProps): React.ReactElement {
  const contentStyle = padded ? styles.padded : undefined;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  fill: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
});

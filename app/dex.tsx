'use client';

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { useCaptures } from '@/hooks/useCaptures';
import CaptureCard from '@/components/CaptureCard';
import Screen from '@/components/Screen';
import { Button } from '@/components/Button';
import { ElementChip } from '@/components/ElementChip';
import { RarityBadge } from '@/components/RarityBadge';
import type { Capture, Element, Rarity } from '@/engine/types';
import { colors, space, typography } from '@/components/theme';

// ---------------------------------------------------------------------------
// Filter / sort types
// ---------------------------------------------------------------------------

type SortKey = 'newest' | 'oldest' | 'rarity' | 'element';

type FilterChip =
  | { kind: 'all' }
  | { kind: 'element'; value: Element }
  | { kind: 'rarity'; value: Rarity };

const ELEMENTS: Element[] = ['beast', 'avian', 'aquatic', 'reptile', 'insect', 'flora', 'fungal'];
const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest',  label: 'Newest'  },
  { key: 'oldest',  label: 'Oldest'  },
  { key: 'rarity',  label: 'Rarity'  },
  { key: 'element', label: 'Element' },
];

const RARITY_ORDER: Record<Rarity, number> = {
  legendary: 0,
  epic:      1,
  rare:      2,
  uncommon:  3,
  common:    4,
};

// ---------------------------------------------------------------------------
// Pure helpers (no hooks)
// ---------------------------------------------------------------------------

function chipKey(chip: FilterChip): string {
  if (chip.kind === 'all') return 'all';
  return `${chip.kind}:${chip.value}`;
}

function applyFilter(captures: Capture[], active: FilterChip): Capture[] {
  if (active.kind === 'all') return captures;
  if (active.kind === 'element') {
    return captures.filter((c) => c.stats.element === active.value);
  }
  return captures.filter((c) => c.stats.rarity === active.value);
}

function applySort(captures: Capture[], sort: SortKey): Capture[] {
  const copy = [...captures];
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'oldest':
      return copy.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case 'rarity':
      return copy.sort(
        (a, b) => RARITY_ORDER[a.stats.rarity] - RARITY_ORDER[b.stats.rarity],
      );
    case 'element':
      return copy.sort((a, b) => a.stats.element.localeCompare(b.stats.element));
  }
}

// ---------------------------------------------------------------------------
// FilterChipButton
// ---------------------------------------------------------------------------

interface FilterChipButtonProps {
  chip: FilterChip;
  active: boolean;
  onPress: () => void;
}

function FilterChipButton({ chip, active, onPress }: FilterChipButtonProps): React.ReactElement {
  const wrapStyle = [styles.filterChip, active && styles.filterChipActive];

  if (chip.kind === 'all') {
    return (
      <Pressable
        onPress={onPress}
        style={wrapStyle}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
          All
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={wrapStyle}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {chip.kind === 'element' ? (
        <ElementChip element={chip.value} size="sm" />
      ) : (
        <RarityBadge rarity={chip.value} size="sm" />
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// SortControl
// ---------------------------------------------------------------------------

interface SortControlProps {
  current: SortKey;
  onChange: (key: SortKey) => void;
}

function SortControl({ current, onChange }: SortControlProps): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.sortRow}
      contentContainerStyle={styles.sortContent}
    >
      {SORT_OPTIONS.map(({ key, label }) => {
        const active = current === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[styles.sortChip, active && styles.sortChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// LoadingState
// ---------------------------------------------------------------------------

function LoadingState(): React.ReactElement {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.text.accent} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  isFiltered: boolean;
}

function EmptyState({ isFiltered }: EmptyStateProps): React.ReactElement {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {isFiltered
          ? 'No captures match this filter.'
          : 'Your dex is empty. Capture your first animal!'}
      </Text>
      {!isFiltered && (
        <Button
          label="Go Capture"
          variant="primary"
          size="lg"
          onPress={() => router.push('/capture')}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// GridItem — wraps CaptureCard with column gutter logic
// ---------------------------------------------------------------------------

interface GridItemProps {
  capture: Capture;
  index: number;
}

function GridItem({ capture, index }: GridItemProps): React.ReactElement {
  const isLeft = index % 2 === 0;

  function handlePress(): void {
    router.push({ pathname: '/capture/[id]', params: { id: capture.id } });
  }

  return (
    <View style={[styles.gridItem, isLeft ? styles.gridItemLeft : styles.gridItemRight]}>
      <CaptureCard capture={capture} onPress={handlePress} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// DexScreen
// ---------------------------------------------------------------------------

export default function DexScreen(): React.ReactElement {
  const { data: captures = [], isLoading, refetch, isRefetching } = useCaptures();

  const [activeFilter, setActiveFilter] = useState<FilterChip>({ kind: 'all' });
  const [sort, setSort] = useState<SortKey>('newest');

  const ALL_CHIPS: FilterChip[] = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [{ kind: 'all' }];
    ELEMENTS.forEach((e) => chips.push({ kind: 'element', value: e }));
    RARITIES.forEach((r) => chips.push({ kind: 'rarity', value: r }));
    return chips;
  }, []);

  const displayed = useMemo<Capture[]>(() => {
    return applySort(applyFilter(captures, activeFilter), sort);
  }, [captures, activeFilter, sort]);

  function handleChipPress(chip: FilterChip): void {
    const same = chipKey(chip) === chipKey(activeFilter);
    setActiveFilter(same ? { kind: 'all' } : chip);
  }

  if (isLoading) {
    return (
      <Screen scroll={false} padded={false}>
        <LoadingState />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dex</Text>
        <Text style={styles.headerSubtitle}>{captures.length} captures</Text>
      </View>

      {/* ── Filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {ALL_CHIPS.map((chip) => (
          <FilterChipButton
            key={chipKey(chip)}
            chip={chip}
            active={chipKey(chip) === chipKey(activeFilter)}
            onPress={() => handleChipPress(chip)}
          />
        ))}
      </ScrollView>

      {/* ── Sort control ── */}
      <SortControl current={sort} onChange={setSort} />

      {/* ── 2-column grid ── */}
      <FlatList<Capture>
        data={displayed}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item, index }) => <GridItem capture={item} index={index} />}
        contentContainerStyle={[
          styles.gridContent,
          displayed.length === 0 && styles.gridContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<EmptyState isFiltered={activeFilter.kind !== 'all'} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.text.accent}
            colors={[colors.text.accent]}
          />
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Header
  header: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
    gap: space[1],
  },
  headerTitle: {
    color: colors.text.primary,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.heavy,
    lineHeight: typography.size.xl * typography.leading.tight,
  },
  headerSubtitle: {
    color: colors.text.secondary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.regular,
    lineHeight: typography.size.sm * typography.leading.normal,
  },

  // Filter chips row
  filterRow: {
    flexGrow: 0,
  },
  filterContent: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: space[2],
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    backgroundColor: colors.bg.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    borderColor: colors.border.focus,
    backgroundColor: colors.bg.elevated,
  },
  filterChipText: {
    color: colors.text.secondary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  filterChipTextActive: {
    color: colors.text.accent,
  },

  // Sort row
  sortRow: {
    flexGrow: 0,
  },
  sortContent: {
    paddingHorizontal: space[4],
    paddingBottom: space[3],
    gap: space[2],
  },
  sortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    backgroundColor: 'transparent',
  },
  sortChipActive: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.bg.elevated,
  },
  sortChipText: {
    color: colors.text.muted,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  sortChipTextActive: {
    color: colors.brand.primary,
  },

  // Grid
  gridContent: {
    paddingHorizontal: space[2],
    paddingBottom: space[6],
  },
  gridContentEmpty: {
    flexGrow: 1,
  },
  gridItem: {
    flex: 1,
    paddingVertical: space[2],
  },
  gridItemLeft: {
    paddingLeft: space[2],
    paddingRight: space[1],
  },
  gridItemRight: {
    paddingLeft: space[1],
    paddingRight: space[2],
  },

  // Loading
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space[6],
    gap: space[6],
  },
  emptyText: {
    color: colors.text.secondary,
    fontSize: typography.size.base,
    fontWeight: typography.weight.regular,
    textAlign: 'center',
    lineHeight: typography.size.base * typography.leading.loose,
  },
});

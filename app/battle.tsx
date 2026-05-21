/**
 * app/battle.tsx — Battle history index screen (Wildex v0.2)
 *
 * Shows the current user's battle history (win/loss record, opponent names,
 * capture thumbnails, date). Tapping a row navigates to /battle/[id] for the
 * full animated replay.
 *
 * CTA at top: "Challenge a Friend" → /challenge
 *
 * Spec refs:
 *   spec/SPEC.md §4.6 (accept and resolve a battle)
 *   spec/design-brief.md §6.4 (battle screen layout)
 *   spec/architecture.md §9 (dependency direction rules)
 *
 * Data:  useBattleHistory()  — hooks/useBattles.ts
 * Route: /battle/[id]        — app/battle/[id].tsx (replay screen)
 */

import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import Screen from '@/components/Screen';
import Card from '@/components/Card';
import { colors, space, typography, radius } from '@/components/theme';
import { useBattleHistory } from '@/hooks/useBattles';
import { useAuth } from '@/lib/AuthContext';
import type { Battle } from '@/engine/types';

// ---------------------------------------------------------------------------
// Win/loss record derived from battle history
// ---------------------------------------------------------------------------

function computeRecord(battles: Battle[], userId: string): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const b of battles) {
    const isPlayerA = b.player_a === userId;
    const won = (isPlayerA && b.winner === 'a') || (!isPlayerA && b.winner === 'b');
    if (won) wins++;
    else losses++;
  }
  return { wins, losses };
}

// ---------------------------------------------------------------------------
// Date formatting — relative within 24 h, absolute beyond
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// BattleRow — single history list item
// ---------------------------------------------------------------------------

interface BattleRowProps {
  battle: Battle;
  userId: string;
  onPress: () => void;
}

function BattleRow({ battle, userId, onPress }: BattleRowProps): React.ReactElement {
  const isPlayerA = battle.player_a === userId;
  const won = (isPlayerA && battle.winner === 'a') || (!isPlayerA && battle.winner === 'b');
  const opponentId = isPlayerA ? battle.player_b : battle.player_a;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="View battle replay">
      <Card variant="surface" padding={4}>
        <View style={styles.rowInner}>
          {/* Left: W/L badge */}
          <View style={[styles.badge, won ? styles.badgeWin : styles.badgeLoss]}>
            <Text style={styles.badgeText}>{won ? 'W' : 'L'}</Text>
          </View>

          {/* Middle: opponent + capture slugs */}
          <View style={styles.rowMeta}>
            <Text style={styles.opponentId} numberOfLines={1}>
              {opponentId.slice(0, 8)}
            </Text>
            <Text style={styles.captureIds} numberOfLines={1}>
              {battle.capture_a.slice(0, 6)} vs {battle.capture_b.slice(0, 6)}
            </Text>
          </View>

          {/* Right: date + chevron */}
          <View style={styles.rowRight}>
            <Text style={styles.date}>{formatDate(battle.created_at)}</Text>
            <Text style={styles.chevron}>{'›'}</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — shown when history list is empty
// ---------------------------------------------------------------------------

function EmptyState(): React.ReactElement {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No battles yet.</Text>
      <Text style={styles.emptyBody}>Send your first challenge!</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BattleScreen — default export
// ---------------------------------------------------------------------------

export default function BattleScreen(): React.ReactElement {
  const router = useRouter();
  const { user } = useAuth();
  const { data: battles, isLoading, isError, error } = useBattleHistory();

  const record = battles && user
    ? computeRecord(battles, user.id)
    : null;

  function handleChallengePress(): void {
    router.push('/challenge');
  }

  function handleRowPress(id: string): void {
    router.push(`/battle/${id}` as const);
  }

  return (
    <Screen scroll={false} padded>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Battles</Text>
        {record && (
          <Text style={styles.record}>
            {record.wins}W — {record.losses}L
          </Text>
        )}
      </View>

      {/* CTA */}
      <Pressable
        style={styles.ctaButton}
        onPress={handleChallengePress}
        accessibilityRole="button"
        accessibilityLabel="Challenge a friend"
      >
        <Text style={styles.ctaText}>Challenge a Friend</Text>
      </Pressable>

      {/* Loading */}
      {isLoading && (
        <View style={styles.centeredFeedback}>
          <ActivityIndicator size="large" color={colors.brand.primary} />
          <Text style={styles.feedbackText}>Loading battles…</Text>
        </View>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <View style={styles.centeredFeedback}>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Failed to load battles.'}
          </Text>
        </View>
      )}

      {/* List */}
      {!isLoading && !isError && (
        <FlatList
          data={battles ?? []}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={<EmptyState />}
          renderItem={({ item }) => (
            <BattleRow
              battle={item}
              userId={user?.id ?? ''}
              onPress={() => handleRowPress(item.id)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    marginBottom: space[4],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.heavy,
    color: colors.text.primary,
    lineHeight: typography.size.xl * typography.leading.tight,
  },
  record: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.text.secondary,
    marginTop: space[1],
  },
  ctaButton: {
    backgroundColor: colors.brand.primary,
    borderRadius: radius.md,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    alignItems: 'center',
    marginBottom: space[6],
  },
  ctaText: {
    fontSize: typography.size.base,
    fontWeight: typography.weight.bold,
    color: colors.text.inverse,
  },
  list: {
    gap: space[2],
    paddingBottom: space[8],
  },
  separator: {
    height: space[2],
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWin: {
    backgroundColor: colors.status.success,
  },
  badgeLoss: {
    backgroundColor: colors.status.error,
  },
  badgeText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.heavy,
    color: colors.text.inverse,
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  opponentId: {
    fontSize: typography.size.base,
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
  },
  captureIds: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    fontFamily: 'ui-monospace',
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  date: {
    fontSize: typography.size.xs,
    color: colors.text.secondary,
  },
  chevron: {
    fontSize: typography.size.lg,
    color: colors.text.muted,
  },
  centeredFeedback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
  },
  feedbackText: {
    fontSize: typography.size.sm,
    color: colors.text.secondary,
  },
  errorText: {
    fontSize: typography.size.sm,
    color: colors.status.error,
    textAlign: 'center',
    paddingHorizontal: space[6],
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[12],
    gap: space[2],
  },
  emptyTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
    lineHeight: typography.size.lg * typography.leading.loose,
  },
  emptyBody: {
    fontSize: typography.size.base,
    color: colors.text.secondary,
    lineHeight: typography.size.base * typography.leading.loose,
  },
});

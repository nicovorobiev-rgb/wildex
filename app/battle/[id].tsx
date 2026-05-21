/**
 * app/battle/[id].tsx — Battle replay screen (Wildex v0.2)
 *
 * Pure presentation screen. All data fetching and simulation is handled by
 * useBattleReplay (hooks/useBattles.ts), which follows the dep-direction rule:
 *   screen → hook → service → engine
 *
 * Replay animation:
 *   - Each turn fades in over 200 ms via react-native Animated.
 *   - The attacking BattleSlot glows during its turn (isAttacker prop pulsed
 *     in BattleSlot itself; we just toggle which slot is "attacker").
 *   - HP bars animate automatically via HPBar's internal Animated.timing.
 *
 * Spec refs:
 *   spec/SPEC.md §4.6, §2.10
 *   spec/design-brief.md §6.4 (battle screen layout + motion §9)
 *   engine/types.ts (Battle, Turn, BattleLog, BattleStats)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import Screen from '@/components/Screen';
import BattleSlot from '@/components/BattleSlot';
import Card from '@/components/Card';
import { colors, space, typography, radius } from '@/components/theme';
import { useBattleReplay } from '@/hooks/useBattles';
import type { Turn } from '@/engine/types';

// ---------------------------------------------------------------------------
// Replay state machine
// ---------------------------------------------------------------------------

type ReplayPhase = 'idle' | 'playing' | 'done';

// How long each turn is displayed before advancing (ms)
const TURN_INTERVAL_MS = 900;
// Fade-in duration per turn (ms)
const TURN_FADE_MS = 200;

// ---------------------------------------------------------------------------
// TurnLogLine — animated entry for each turn
// ---------------------------------------------------------------------------

interface TurnLogLineProps {
  turn: Turn;
  nameA: string;
  nameB: string;
}

function TurnLogLine({ turn, nameA, nameB }: TurnLogLineProps): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: TURN_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  const attacker = turn.attacker === 'a' ? nameA : nameB;

  return (
    <Animated.View style={[styles.logLine, { opacity }]}>
      <Text style={styles.logTurn}>T{turn.turn}</Text>
      <Text style={styles.logText}>
        {attacker} hit for{' '}
        <Text style={[styles.logDamage, turn.crit && styles.logDamageCrit]}>
          {turn.damage}
        </Text>
        {turn.crit ? ' (crit!)' : ''}
      </Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// useReplay — drives the turn-by-turn animation
// ---------------------------------------------------------------------------

interface ReplayState {
  visibleTurns: Turn[];
  currentHpA: number;
  currentHpB: number;
  attackerSide: 'a' | 'b' | null;
  phase: ReplayPhase;
}

function useReplay(
  log: Turn[],
  maxHpA: number,
  maxHpB: number,
  enabled: boolean,
): ReplayState {
  const [visibleTurns, setVisibleTurns] = useState<Turn[]>([]);
  const [currentHpA, setCurrentHpA] = useState(maxHpA);
  const [currentHpB, setCurrentHpB] = useState(maxHpB);
  const [attackerSide, setAttackerSide] = useState<'a' | 'b' | null>(null);
  const [phase, setPhase] = useState<ReplayPhase>('idle');
  const indexRef = useRef(0);

  useEffect(() => {
    if (!enabled || log.length === 0) return;

    setPhase('playing');
    indexRef.current = 0;

    const timer = setInterval(() => {
      const idx = indexRef.current;
      if (idx >= log.length) {
        setPhase('done');
        setAttackerSide(null);
        clearInterval(timer);
        return;
      }

      const turn = log[idx];
      setAttackerSide(turn.attacker);
      setVisibleTurns((prev) => [...prev, turn]);

      if (turn.attacker === 'a') {
        setCurrentHpB((hp) => Math.max(0, hp - turn.damage));
      } else {
        setCurrentHpA((hp) => Math.max(0, hp - turn.damage));
      }

      indexRef.current = idx + 1;
    }, TURN_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [enabled, log, maxHpA, maxHpB]);

  return { visibleTurns, currentHpA, currentHpB, attackerSide, phase };
}

// ---------------------------------------------------------------------------
// BattleReplayScreen — default export
// ---------------------------------------------------------------------------

export default function BattleReplayScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { battle, captureA, captureB, replay: simResult, isLoading, error } =
    useBattleReplay(id ?? '');

  const log: Turn[] = simResult?.log ?? [];
  const maxHpA = captureA?.stats.hp ?? 1;
  const maxHpB = captureB?.stats.hp ?? 1;
  const replayReady = simResult !== null;

  const replay = useReplay(log, maxHpA, maxHpB, replayReady);

  const nameA = captureA?.common_name ?? 'Capture A';
  const nameB = captureB?.common_name ?? 'Capture B';

  // Map winnerId (capture id string) → 'a' | 'b' for display
  const winner: 'a' | 'b' | null =
    simResult && captureA && simResult.winnerId === captureA.id ? 'a' :
    simResult ? 'b' : null;

  const hasError = Boolean(error);

  function handleBack(): void {
    router.back();
  }

  // Winner display name
  const winnerName = winner === 'a' ? nameA : winner === 'b' ? nameB : null;

  return (
    <Screen scroll padded>
      {/* Back */}
      <Pressable onPress={handleBack} style={styles.backRow} accessibilityRole="button">
        <Text style={styles.backText}>{'‹ Back'}</Text>
      </Pressable>

      <Text style={styles.title}>Battle Replay</Text>
      {battle && (
        <Text style={styles.seedLine} numberOfLines={1}>
          seed: {battle.seed}
        </Text>
      )}

      {/* Loading */}
      {isLoading && (
        <View style={styles.centeredFeedback}>
          <ActivityIndicator size="large" color={colors.brand.primary} />
          <Text style={styles.feedbackText}>Loading replay…</Text>
        </View>
      )}

      {/* Error */}
      {hasError && !isLoading && (
        <View style={styles.centeredFeedback}>
          <Text style={styles.errorText}>
            {error?.message ?? 'Failed to load battle. Try again.'}
          </Text>
          <Pressable onPress={handleBack} style={styles.retryButton}>
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      )}

      {/* Arena — only shown when captures are ready */}
      {!isLoading && !hasError && captureA && captureB && (
        <>
          {/* Battle slots */}
          <View style={styles.arena}>
            {/* Opponent slot (top-right) */}
            <View style={styles.slotOpponent}>
              <BattleSlot
                capture={captureB}
                imageUrl={null}
                currentHp={replay.currentHpB}
                isAttacker={replay.attackerSide === 'b'}
                isPlayer={false}
              />
            </View>
            {/* Player slot (bottom-left) */}
            <View style={styles.slotPlayer}>
              <BattleSlot
                capture={captureA}
                imageUrl={null}
                currentHp={replay.currentHpA}
                isAttacker={replay.attackerSide === 'a'}
                isPlayer
              />
            </View>
          </View>

          {/* Phase indicator */}
          <View style={styles.phaseRow}>
            {replay.phase === 'playing' && (
              <Text style={styles.phaseText}>Battle in progress…</Text>
            )}
            {replay.phase === 'done' && winnerName && (
              <Card variant="elevated" padding={4} tone="accent">
                <Text style={styles.winnerText}>Winner: {winnerName}</Text>
              </Card>
            )}
          </View>

          {/* Turn log */}
          <View style={styles.logContainer}>
            <Text style={styles.logHeader}>TURN LOG</Text>
            {replay.visibleTurns.map((t) => (
              <TurnLogLine
                key={t.turn}
                turn={t}
                nameA={nameA}
                nameB={nameB}
              />
            ))}
            {replay.phase === 'idle' && (
              <Text style={styles.logEmpty}>Preparing replay…</Text>
            )}
          </View>

          {/* Seed attribution */}
          <Text style={styles.seedCaption} numberOfLines={2}>
            seed: {battle?.seed ?? '—'}
          </Text>
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backRow: {
    marginBottom: space[3],
  },
  backText: {
    fontSize: typography.size.base,
    color: colors.text.accent,
    fontWeight: typography.weight.medium,
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.heavy,
    color: colors.text.primary,
    marginBottom: space[1],
    lineHeight: typography.size.xl * typography.leading.tight,
  },
  seedLine: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    fontFamily: 'ui-monospace',
    marginBottom: space[4],
  },
  arena: {
    height: 320,
    position: 'relative',
    marginBottom: space[4],
    backgroundColor: colors.bg.surfaceAlt,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  slotOpponent: {
    position: 'absolute',
    top: space[4],
    right: space[4],
  },
  slotPlayer: {
    position: 'absolute',
    bottom: space[4],
    left: space[4],
  },
  phaseRow: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[4],
  },
  phaseText: {
    fontSize: typography.size.sm,
    color: colors.text.secondary,
    fontWeight: typography.weight.medium,
  },
  winnerText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.heavy,
    color: colors.text.accent,
    textAlign: 'center',
  },
  logContainer: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[4],
    gap: space[2],
  },
  logHeader: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.text.muted,
    letterSpacing: 1,
    marginBottom: space[1],
  },
  logLine: {
    flexDirection: 'row',
    gap: space[2],
    alignItems: 'center',
  },
  logTurn: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    fontFamily: 'ui-monospace',
    width: 24,
  },
  logText: {
    fontSize: typography.size.sm,
    color: colors.text.secondary,
    flex: 1,
  },
  logDamage: {
    fontWeight: typography.weight.bold,
    color: colors.text.primary,
  },
  logDamageCrit: {
    color: colors.status.warning,
  },
  logEmpty: {
    fontSize: typography.size.sm,
    color: colors.text.muted,
    fontStyle: 'italic',
  },
  seedCaption: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    fontFamily: 'ui-monospace',
    textAlign: 'center',
    marginBottom: space[8],
  },
  centeredFeedback: {
    flex: 1,
    minHeight: 200,
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
  retryButton: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.elevated,
    borderRadius: radius.md,
  },
  retryText: {
    fontSize: typography.size.sm,
    color: colors.text.accent,
    fontWeight: typography.weight.medium,
  },
});

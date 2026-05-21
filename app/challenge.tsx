/**
 * app/challenge.tsx — Wildex v0.2 Challenge screen.
 *
 * Two sections:
 *   1. Send a challenge: pick a friend + your capture → useSendChallenge
 *   2. Incoming / outgoing challenge lists
 *
 * Spec refs:
 *   spec/SPEC.md §2.9 (send challenge), §2.10 (accept + resolve)
 *   spec/SPEC.md §4.5 (send flow), §4.6 (accept flow)
 *   spec/design-brief.md §6.6 (challenge screen layout)
 *
 * Contract:
 *   SendChallengeInput carries only opponent_id + my_capture_id — the opponent
 *   picks their capture at accept time (spec §2.9, §4.5).
 *   useAcceptChallenge takes { challenge_id, opponent_capture_id }; the
 *   AcceptPicker threads the selected capture id through to the mutation.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useChallenges, useSendChallenge, useAcceptChallenge } from '@/hooks/useBattles';
import { useFriends } from '@/hooks/useFriends';
import { useCaptures } from '@/hooks/useCaptures';
import { CaptureChip } from '@/components/CaptureChip';
import Screen from '@/components/Screen';
import { Button } from '@/components/Button';
import { colors, space, typography, radius } from '@/components/theme';
import type { Capture, Challenge, Friend } from '@/engine/types';

// ---------------------------------------------------------------------------
// Sub-components (each under 20 lines)
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  label: string;
}

function SectionHeader({ label }: SectionHeaderProps): React.ReactElement {
  return (
    <Text style={styles.sectionHeader}>{label.toUpperCase()}</Text>
  );
}

interface EmptyNoteProps {
  message: string;
}

function EmptyNote({ message }: EmptyNoteProps): React.ReactElement {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

interface FriendRowProps {
  friend: Friend;
  selected: boolean;
  onPress: () => void;
}

function FriendRow({ friend, selected, onPress }: FriendRowProps): React.ReactElement {
  return (
    <TouchableOpacity
      style={[styles.friendRow, selected && styles.friendRowSelected]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={styles.friendName}>
        {friend.display_name ?? friend.friend_code}
      </Text>
      <Text style={styles.friendCode}>{friend.friend_code}</Text>
    </TouchableOpacity>
  );
}

interface ChallengeStatusBadgeProps {
  challenge: Challenge;
}

function ChallengeStatusBadge({ challenge }: ChallengeStatusBadgeProps): React.ReactElement {
  if (challenge.winner !== null) {
    return <Text style={styles.statusResolved}>resolved</Text>;
  }
  return <Text style={styles.statusPending}>pending</Text>;
}

// ---------------------------------------------------------------------------
// Accept picker modal (inline sheet)
// ---------------------------------------------------------------------------

interface AcceptPickerProps {
  challenge: Challenge;
  captures: Capture[];
  onCancel: () => void;
  onAccept: (challengeId: string, captureId: string) => void;
  loading: boolean;
}

function AcceptPicker({
  challenge,
  captures,
  onCancel,
  onAccept,
  loading,
}: AcceptPickerProps): React.ReactElement {
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);

  function handleAccept() {
    if (!selectedCapture) return;
    onAccept(challenge.id, selectedCapture.id);
  }

  return (
    <View style={styles.acceptSheet}>
      <Text style={styles.acceptTitle}>Pick your defender</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {captures.map((cap) => (
          <CaptureChip
            key={cap.id}
            capture={cap}
            selected={selectedCapture?.id === cap.id}
            onPress={() => setSelectedCapture(cap)}
          />
        ))}
      </ScrollView>
      {captures.length === 0 && (
        <EmptyNote message="You have no captures to defend with." />
      )}
      <View style={styles.acceptActions}>
        <Button
          label="Cancel"
          variant="ghost"
          onPress={onCancel}
          disabled={loading}
        />
        <Button
          label="Accept"
          variant="primary"
          onPress={handleAccept}
          disabled={!selectedCapture || loading}
          loading={loading}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Incoming challenge row
// ---------------------------------------------------------------------------

interface IncomingRowProps {
  challenge: Challenge;
  captures: Capture[];
  onAccepted: () => void;
}

function IncomingRow({
  challenge,
  captures,
  onAccepted,
}: IncomingRowProps): React.ReactElement {
  const [showPicker, setShowPicker] = useState(false);
  const accept = useAcceptChallenge();
  const router = useRouter();

  const handleAccept = useCallback(
    (challengeId: string, captureId: string) => {
      accept.mutate({ challenge_id: challengeId, opponent_capture_id: captureId }, {
        onSuccess: (result) => {
          setShowPicker(false);
          onAccepted();
          const winner = result.winner === 'a' ? 'challenger' : 'you';
          Alert.alert(
            'Battle resolved',
            `Winner: ${winner}`,
            [
              {
                text: 'View details',
                onPress: () => router.push(`/battle/${challengeId}`),
              },
              { text: 'OK', style: 'cancel' },
            ],
          );
        },
        onError: (err) => {
          Alert.alert('Accept failed', err.message);
        },
      });
    },
    [accept, onAccepted, router],
  );

  if (showPicker) {
    return (
      <View style={styles.challengeCard}>
        <AcceptPicker
          challenge={challenge}
          captures={captures}
          onCancel={() => setShowPicker(false)}
          onAccept={handleAccept}
          loading={accept.isPending}
        />
      </View>
    );
  }

  return (
    <View style={styles.challengeCard}>
      <View style={styles.challengeCardHeader}>
        <Text style={styles.challengeParty}>
          Challenge from {challenge.challenger_id.slice(0, 8)}
        </Text>
        <ChallengeStatusBadge challenge={challenge} />
      </View>
      {challenge.winner === null && (
        <Button
          label="Accept"
          variant="primary"
          size="sm"
          onPress={() => setShowPicker(true)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Outgoing challenge row
// ---------------------------------------------------------------------------

interface OutgoingRowProps {
  challenge: Challenge;
}

function OutgoingRow({ challenge }: OutgoingRowProps): React.ReactElement {
  const router = useRouter();

  function handleTap() {
    if (challenge.winner !== null) {
      router.push(`/battle/${challenge.id}`);
    }
  }

  const opponentLabel = challenge.opponent_id
    ? challenge.opponent_id.slice(0, 8)
    : 'unknown';

  return (
    <TouchableOpacity
      style={styles.challengeCard}
      onPress={handleTap}
      activeOpacity={challenge.winner !== null ? 0.7 : 1}
      accessibilityRole="button"
    >
      <View style={styles.challengeCardHeader}>
        <Text style={styles.challengeParty}>
          vs {opponentLabel}
        </Text>
        <ChallengeStatusBadge challenge={challenge} />
      </View>
      {challenge.winner !== null && (
        <Text style={styles.resultLabel}>
          {challenge.winner === 'a' ? 'You won' : 'You lost'} — tap to view
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ChallengeScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ opponent?: string }>();

  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(
    params.opponent ?? null,
  );
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);

  const friends = useFriends();
  const captures = useCaptures();
  const incoming = useChallenges('incoming');
  const outgoing = useChallenges('outgoing');
  const sendChallenge = useSendChallenge();

  const canSend = selectedFriendId !== null && selectedCapture !== null && !sendChallenge.isPending;

  const handleSend = useCallback(() => {
    if (!selectedFriendId || !selectedCapture) return;
    sendChallenge.mutate(
      {
        opponent_id: selectedFriendId,
        my_capture_id: selectedCapture.id,
      },
      {
        onSuccess: () => {
          Alert.alert('Sent', "You'll see the result here when they respond.");
          setSelectedCapture(null);
        },
        onError: (err) => {
          Alert.alert('Send failed', err.message);
        },
      },
    );
  }, [selectedFriendId, selectedCapture, sendChallenge]);

  const captureData = captures.data ?? [];
  const friendData = friends.data ?? [];
  const incomingData = incoming.data ?? [];
  const outgoingData = outgoing.data ?? [];

  return (
    <Screen scroll>
      {/* ── Section 1: Send a challenge ── */}
      <SectionHeader label="Challenge a friend" />

      {/* Friend picker */}
      <Text style={styles.subLabel}>Pick a friend</Text>
      {friends.isLoading && <ActivityIndicator color={colors.text.accent} style={styles.loader} />}
      {!friends.isLoading && friendData.length === 0 && (
        <EmptyNote message="Add friends first to send a challenge." />
      )}
      {friendData.map((f) => (
        <FriendRow
          key={f.user_id}
          friend={f}
          selected={selectedFriendId === f.user_id}
          onPress={() => setSelectedFriendId(f.user_id)}
        />
      ))}

      {/* Capture picker */}
      <Text style={[styles.subLabel, styles.subLabelSpaced]}>Your capture</Text>
      {captures.isLoading && <ActivityIndicator color={colors.text.accent} style={styles.loader} />}
      {!captures.isLoading && captureData.length === 0 && (
        <EmptyNote message="Capture an animal first to challenge friends." />
      )}
      {captureData.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {captureData.map((cap) => (
            <CaptureChip
              key={cap.id}
              capture={cap}
              selected={selectedCapture?.id === cap.id}
              onPress={() => setSelectedCapture(cap)}
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.sendRow}>
        <Button
          label={sendChallenge.isPending ? 'Sending...' : 'Send Challenge'}
          variant="primary"
          fullWidth
          disabled={!canSend}
          loading={sendChallenge.isPending}
          onPress={handleSend}
        />
      </View>

      {/* ── Section 2: Incoming challenges ── */}
      <View style={styles.section}>
        <SectionHeader label="Incoming" />
        {incoming.isLoading && (
          <ActivityIndicator color={colors.text.accent} style={styles.loader} />
        )}
        {!incoming.isLoading && incomingData.length === 0 && (
          <EmptyNote message="No incoming challenges." />
        )}
        {incomingData.map((ch) => (
          <IncomingRow
            key={ch.id}
            challenge={ch}
            captures={captureData}
            onAccepted={() => {
              incoming.refetch();
              outgoing.refetch();
            }}
          />
        ))}
      </View>

      {/* ── Section 3: Outgoing challenges ── */}
      <View style={styles.section}>
        <SectionHeader label="Outgoing" />
        {outgoing.isLoading && (
          <ActivityIndicator color={colors.text.accent} style={styles.loader} />
        )}
        {!outgoing.isLoading && outgoingData.length === 0 && (
          <EmptyNote message="No outgoing challenges." />
        )}
        {outgoingData.map((ch) => (
          <OutgoingRow key={ch.id} challenge={ch} />
        ))}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  sectionHeader: {
    color:        colors.text.muted,
    fontSize:     typography.size.xs,
    fontWeight:   typography.weight.medium,
    letterSpacing: 1.2,
    marginBottom: space[2],
    marginTop:    space[1],
  },
  subLabel: {
    color:        colors.text.secondary,
    fontSize:     typography.size.sm,
    fontWeight:   typography.weight.medium,
    marginBottom: space[1],
  },
  subLabelSpaced: {
    marginTop: space[4],
  },
  loader: {
    marginVertical: space[2],
  },
  emptyWrap: {
    paddingVertical:   space[3],
    paddingHorizontal: space[4],
    backgroundColor:   colors.bg.surface,
    borderRadius:      radius.md,
    marginBottom:      space[2],
  },
  emptyText: {
    color:    colors.text.muted,
    fontSize: typography.size.sm,
  },
  friendRow: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    padding:         space[3],
    backgroundColor: colors.bg.surface,
    borderRadius:    radius.md,
    borderWidth:     2,
    borderColor:     colors.border.subtle,
    marginBottom:    space[2],
  },
  friendRowSelected: {
    borderColor: colors.border.focus,
  },
  friendName: {
    color:      colors.text.primary,
    fontSize:   typography.size.base,
    fontWeight: typography.weight.medium,
  },
  friendCode: {
    color:      colors.text.muted,
    fontSize:   typography.size.xs,
    fontFamily: 'ui-monospace',
  },
  chipRow: {
    gap:           space[2],
    paddingBottom: space[1],
  },
  sendRow: {
    marginTop: space[4],
  },
  section: {
    marginTop: space[6],
  },
  challengeCard: {
    backgroundColor: colors.bg.surface,
    borderRadius:    radius.lg,
    padding:         space[4],
    marginBottom:    space[3],
    gap:             space[3],
  },
  challengeCardHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  challengeParty: {
    color:      colors.text.primary,
    fontSize:   typography.size.base,
    fontWeight: typography.weight.medium,
    flex:       1,
  },
  statusPending: {
    color:      colors.status.warning,
    fontSize:   typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  statusResolved: {
    color:      colors.text.muted,
    fontSize:   typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  resultLabel: {
    color:    colors.text.secondary,
    fontSize: typography.size.sm,
  },
  acceptSheet: {
    gap: space[3],
  },
  acceptTitle: {
    color:      colors.text.primary,
    fontSize:   typography.size.base,
    fontWeight: typography.weight.medium,
  },
  acceptActions: {
    flexDirection:  'row',
    justifyContent: 'flex-end',
    gap:            space[2],
  },
});

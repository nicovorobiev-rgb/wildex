'use client';

// app/friends.tsx — Wildex v0.2 Friends screen.
//
// Spec refs:
//   spec/SPEC.md §2.8 (Friend codes), §4.4 (Add a friend flow)
//   spec/design-brief.md §6.6 (challenge screen layout adapted for friends)
//
// Implements:
//   - Your friend code (large, copyable via FriendCodeChip)
//   - Add a friend by 8-char code
//   - Incoming pending requests with Accept / Decline
//   - Accepted friends list with Challenge / Remove

import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import Screen from '@/components/Screen';
import Card from '@/components/Card';
import { Button } from '@/components/Button';
import { FriendCodeChip } from '@/components/FriendCodeChip';
import { colors, space, typography, radius } from '@/components/theme';
import {
  useFriends,
  useMyFriendCode,
  usePendingRequests,
  useAddFriend,
  useAcceptFriendRequest,
  useRemoveFriend,
} from '@/hooks/useFriends';
import type { Friend, FriendRequest } from '@/services/friends';

// ---------------------------------------------------------------------------
// Sub-components — kept under 20 lines each.
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <Text style={styles.sectionHeader}>{label}</Text>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <Text style={styles.emptyHint}>{text}</Text>;
}

function LoadingHint({ text }: { text: string }) {
  return <Text style={styles.loadingHint}>{text}</Text>;
}

// ---------------------------------------------------------------------------
// My Friend Code section
// ---------------------------------------------------------------------------

function MyFriendCodeSection() {
  const { data: code, isLoading, isError } = useMyFriendCode();

  return (
    <View style={styles.section}>
      <SectionHeader label="YOUR FRIEND CODE" />
      <Card>
        {isLoading && <LoadingHint text="Loading your code…" />}
        {isError && <EmptyHint text="Could not load your friend code." />}
        {code != null && (
          <FriendCodeChip code={code} size="lg" copyable />
        )}
      </Card>
      <Text style={styles.caption}>
        Share this code with a friend so they can add you.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Add a Friend section
// ---------------------------------------------------------------------------

function AddFriendSection() {
  const [inputCode, setInputCode] = useState('');
  const { mutate, isPending, isSuccess, isError, error, reset } = useAddFriend();

  function handleAdd() {
    const trimmed = inputCode.trim().toUpperCase();
    if (trimmed.length !== 8) return;
    mutate(trimmed, {
      onSuccess: () => setInputCode(''),
    });
  }

  function handleChange(text: string) {
    reset();
    setInputCode(text.toUpperCase().slice(0, 8));
  }

  const canSubmit = inputCode.trim().length === 8 && !isPending;

  return (
    <View style={styles.section}>
      <SectionHeader label="ADD A FRIEND" />
      <Card padding={3}>
        <TextInput
          style={styles.codeInput}
          value={inputCode}
          onChangeText={handleChange}
          placeholder="XXXXXXXX"
          placeholderTextColor={colors.text.muted}
          autoCapitalize="characters"
          maxLength={8}
          autoCorrect={false}
          accessibilityLabel="Enter friend code"
        />
      </Card>
      <View style={styles.addRow}>
        <Button
          label="Add"
          onPress={handleAdd}
          disabled={!canSubmit}
          loading={isPending}
          size="md"
        />
        {isSuccess && (
          <Text style={styles.successText}>Friend request sent!</Text>
        )}
        {isError && (
          <Text style={styles.errorText}>
            {error?.message ?? 'Could not add friend.'}
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pending Requests section
// ---------------------------------------------------------------------------

function PendingRequestRow({
  request,
  onAccept,
  onDecline,
  acceptLoading,
  declineLoading,
}: {
  request: FriendRequest;
  onAccept: () => void;
  onDecline: () => void;
  acceptLoading: boolean;
  declineLoading: boolean;
}) {
  const displayName = request.requester_display_name ?? 'Unknown player';

  return (
    <Card padding={3}>
      <View style={styles.rowHeader}>
        <Text style={styles.friendName} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.friendCode}>{request.requester_friend_code}</Text>
      </View>
      <View style={styles.rowActions}>
        <Button
          label="Accept"
          onPress={onAccept}
          loading={acceptLoading}
          disabled={declineLoading}
          variant="primary"
          size="sm"
        />
        <Button
          label="Decline"
          onPress={onDecline}
          loading={declineLoading}
          disabled={acceptLoading}
          variant="ghost"
          size="sm"
        />
      </View>
    </Card>
  );
}

function PendingRequestsSection() {
  const { data: requests, isLoading, isError } = usePendingRequests('incoming');
  const acceptMutation = useAcceptFriendRequest();
  const declineMutation = useRemoveFriend();

  return (
    <View style={styles.section}>
      <SectionHeader label="PENDING REQUESTS" />
      {isLoading && <LoadingHint text="Loading requests…" />}
      {isError && <EmptyHint text="Could not load pending requests." />}
      {!isLoading && !isError && (requests == null || requests.length === 0) && (
        <EmptyHint text="No pending requests." />
      )}
      {requests?.map((req) => (
        <View key={req.requester_id} style={styles.listItem}>
          <PendingRequestRow
            request={req}
            onAccept={() => acceptMutation.mutate(req.requester_id)}
            onDecline={() => declineMutation.mutate(req.requester_id)}
            acceptLoading={
              acceptMutation.isPending &&
              acceptMutation.variables === req.requester_id
            }
            declineLoading={
              declineMutation.isPending &&
              declineMutation.variables === req.requester_id
            }
          />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Friends list section
// ---------------------------------------------------------------------------

function FriendRow({
  friend,
  onChallenge,
  onRemove,
  removeLoading,
}: {
  friend: Friend;
  onChallenge: () => void;
  onRemove: () => void;
  removeLoading: boolean;
}) {
  const displayName = friend.display_name ?? 'Unknown player';

  return (
    <Card padding={3}>
      <View style={styles.rowHeader}>
        <Text style={styles.friendName} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.friendCode}>{friend.friend_code}</Text>
      </View>
      <View style={styles.rowActions}>
        <Button
          label="Challenge"
          onPress={onChallenge}
          variant="secondary"
          size="sm"
        />
        <Button
          label="Remove"
          onPress={onRemove}
          loading={removeLoading}
          variant="ghost"
          size="sm"
        />
      </View>
    </Card>
  );
}

function FriendsListSection() {
  const router = useRouter();
  const { data: friends, isLoading, isError } = useFriends();
  const removeMutation = useRemoveFriend();

  function handleChallenge(friend: Friend) {
    router.push(`/challenge?opponent=${friend.user_id}`);
  }

  function handleRemove(friend: Friend) {
    const name = friend.display_name ?? 'this friend';
    Alert.alert(
      'Remove friend',
      `Remove ${name}? You can re-add them later with their friend code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMutation.mutate(friend.user_id),
        },
      ],
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader label="YOUR FRIENDS" />
      {isLoading && <LoadingHint text="Loading friends…" />}
      {isError && <EmptyHint text="Could not load friends." />}
      {!isLoading && !isError && (friends == null || friends.length === 0) && (
        <EmptyHint text="No friends yet. Share your code above to get started." />
      )}
      {friends?.map((friend) => (
        <View key={friend.user_id} style={styles.listItem}>
          <FriendRow
            friend={friend}
            onChallenge={() => handleChallenge(friend)}
            onRemove={() => handleRemove(friend)}
            removeLoading={
              removeMutation.isPending &&
              removeMutation.variables === friend.user_id
            }
          />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Root screen
// ---------------------------------------------------------------------------

export default function FriendsScreen() {
  return (
    <Screen scroll padded>
      <Text style={styles.screenTitle}>Friends</Text>
      <MyFriendCodeSection />
      <AddFriendSection />
      <PendingRequestsSection />
      <FriendsListSection />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screenTitle: {
    fontSize:    typography.size.xl,
    fontWeight:  typography.weight.bold,
    color:       colors.text.primary,
    marginBottom: space[6],
    lineHeight:  typography.size.xl * typography.leading.tight,
  },
  section: {
    marginBottom: space[6],
    gap: space[3],
  },
  sectionHeader: {
    fontSize:    typography.size.xs,
    fontWeight:  typography.weight.medium,
    color:       colors.text.muted,
    letterSpacing: 1.2,
    marginBottom: space[1],
  },
  caption: {
    fontSize:  typography.size.sm,
    color:     colors.text.secondary,
    lineHeight: typography.size.sm * typography.leading.normal,
  },
  codeInput: {
    fontFamily:  typography.family.mono,
    fontSize:    typography.size.lg,
    fontWeight:  typography.weight.bold,
    color:       colors.text.primary,
    letterSpacing: 2,
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    backgroundColor: 'transparent',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  addRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           space[3],
  },
  successText: {
    fontSize:   typography.size.sm,
    fontWeight: typography.weight.medium,
    color:      colors.status.success,
  },
  errorText: {
    fontSize:   typography.size.sm,
    color:      colors.status.error,
    flexShrink: 1,
  },
  listItem: {
    marginBottom: space[2],
  },
  rowHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   space[2],
  },
  friendName: {
    fontSize:   typography.size.base,
    fontWeight: typography.weight.medium,
    color:      colors.text.primary,
    flexShrink: 1,
    marginRight: space[2],
  },
  friendCode: {
    fontFamily:    typography.family.mono,
    fontSize:      typography.size.xs,
    color:         colors.text.secondary,
    letterSpacing: 1,
  },
  rowActions: {
    flexDirection: 'row',
    gap:           space[2],
  },
  emptyHint: {
    fontSize:   typography.size.sm,
    color:      colors.text.muted,
    lineHeight: typography.size.sm * typography.leading.loose,
  },
  loadingHint: {
    fontSize:   typography.size.sm,
    color:      colors.text.secondary,
    lineHeight: typography.size.sm * typography.leading.normal,
  },
});

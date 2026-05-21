import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, space, typography } from './theme';

// Graceful optional import of expo-clipboard.
let setStringAsync: ((text: string) => Promise<void>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Clipboard = require('expo-clipboard');
  setStringAsync = Clipboard.setStringAsync;
} catch {
  // expo-clipboard not available — copy silently disabled.
}

export type FriendCodeChipSize = 'sm' | 'md' | 'lg';

export interface FriendCodeChipProps {
  code:      string;
  copyable?: boolean;
  size?:     FriendCodeChipSize;
}

const TEXT_STYLES: Record<FriendCodeChipSize, { fontSize: number; fontWeight: string }> = {
  sm: { fontSize: typography.size.sm,   fontWeight: typography.weight.medium },
  md: { fontSize: typography.size.base, fontWeight: typography.weight.bold   },
  lg: { fontSize: typography.size['2xl'], fontWeight: typography.weight.heavy },
};

const TOAST_DURATION_MS = 1800;

export function FriendCodeChip({
  code,
  copyable = true,
  size     = 'md',
}: FriendCodeChipProps) {
  const [copied, setCopied] = useState(false);

  async function handlePress() {
    if (!copyable || !setStringAsync) return;
    try {
      await setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), TOAST_DURATION_MS);
    } catch {
      // clipboard write failed — ignore silently.
    }
  }

  const textStyle = TEXT_STYLES[size];

  const chip = (
    <View style={styles.chip}>
      <Text
        style={[
          styles.code,
          { fontSize: textStyle.fontSize, fontWeight: textStyle.fontWeight as any },
        ]}
        numberOfLines={1}
        selectable={false}
      >
        {code}
      </Text>
      {copyable && (
        <Text style={styles.badge}>
          {copied ? 'Copied!' : 'copy'}
        </Text>
      )}
    </View>
  );

  if (!copyable) return chip;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel={`Friend code ${code}. Tap to copy.`}
      accessibilityRole="button"
      accessibilityHint="Copies your friend code to the clipboard"
      style={({ pressed }) => pressed && styles.pressed}
    >
      {chip}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection:    'row',
    alignItems:       'center',
    alignSelf:        'flex-start',
    paddingHorizontal: space[3],
    paddingVertical:   space[1] + 2, // 6 pt
    backgroundColor:  colors.bg.surfaceAlt,
    borderRadius:     radius.md,
    borderWidth:      1,
    borderColor:      colors.border.default,
    gap:              space[2],
  },
  code: {
    fontFamily: typography.family.mono,
    color:      colors.text.primary,
    letterSpacing: 1,
  },
  badge: {
    fontSize:   typography.size.xs,
    fontWeight: typography.weight.medium,
    color:      colors.text.accent,
    letterSpacing: 0.3,
  },
  pressed: {
    opacity: 0.75,
  },
});

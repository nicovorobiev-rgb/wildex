import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, typography } from './theme';

// Graceful optional import of expo-haptics — not in package.json for this project.
let impactAsync: ((style: string) => Promise<void>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Haptics = require('expo-haptics');
  impactAsync = Haptics.impactAsync;
} catch {
  // expo-haptics not available — haptics silently disabled.
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize    = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label:      string;
  onPress:    () => void;
  variant?:   ButtonVariant;
  size?:      ButtonSize;
  loading?:   boolean;
  disabled?:  boolean;
  leftIcon?:  React.ReactNode;
  fullWidth?: boolean;
}

const SIZE_STYLES: Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number }> = {
  sm: { height: 32, paddingHorizontal: 12, fontSize: typography.size.sm   },
  md: { height: 40, paddingHorizontal: 16, fontSize: typography.size.base },
  lg: { height: 52, paddingHorizontal: 20, fontSize: typography.size.lg   },
};

export function Button({
  label,
  onPress,
  variant   = 'primary',
  size      = 'md',
  loading   = false,
  disabled  = false,
  leftIcon,
  fullWidth = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  async function handlePress() {
    if (isDisabled) return;
    if (impactAsync) {
      try { await impactAsync('light'); } catch { /* ignore */ }
    }
    onPress();
  }

  const sizeStyle = SIZE_STYLES[size];

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        {
          height:            sizeStyle.height,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          alignSelf:         fullWidth ? 'stretch' : 'flex-start',
        },
        pressed && !isDisabled && pressedStyles[variant],
        isDisabled && disabledStyles[variant],
      ]}
    >
      {leftIcon && !loading && (
        <View style={styles.iconWrap}>{leftIcon}</View>
      )}
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' || variant === 'ghost'
            ? colors.text.accent
            : colors.text.inverse}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.label,
            labelStyles[variant],
            { fontSize: sizeStyle.fontSize },
            isDisabled && disabledLabelStyles[variant],
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ─── Base ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  base: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   radius.md,
    overflow:       'hidden',
  },
  iconWrap: {
    marginRight: 6,
  },
  label: {
    fontWeight: typography.weight.medium,
  },

  // variant backgrounds / borders
  primary: {
    backgroundColor: colors.brand.primary,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth:      1,
    borderColor:      colors.border.default,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  destructive: {
    backgroundColor: colors.status.error,
  },
});

// ─── Label colors per variant ────────────────────────────────────────────────

const labelStyles = StyleSheet.create({
  primary:     { color: colors.text.inverse  },
  secondary:   { color: colors.text.primary  },
  ghost:       { color: colors.text.accent   },
  destructive: { color: colors.text.primary  },
});

// ─── Pressed states ──────────────────────────────────────────────────────────

const pressedStyles = StyleSheet.create({
  primary:     { backgroundColor: colors.brand.primaryHover },
  secondary:   { backgroundColor: colors.bg.elevated        },
  ghost:       { backgroundColor: colors.bg.elevated        },
  destructive: { backgroundColor: colors.status.error       },
});

// ─── Disabled states ─────────────────────────────────────────────────────────

const disabledStyles = StyleSheet.create({
  primary:     { backgroundColor: colors.brand.primaryDim   },
  secondary:   { borderColor: colors.border.subtle          },
  ghost:       {},
  destructive: { opacity: 0.5                               },
});

const disabledLabelStyles = StyleSheet.create({
  primary:     { color: colors.text.inverse   },
  secondary:   { color: colors.text.muted     },
  ghost:       { color: colors.text.muted     },
  destructive: { color: colors.text.primary   },
});

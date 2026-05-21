import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { colors, border } from './theme';

// Graceful optional import of expo-haptics.
let impactAsync: ((style: string) => Promise<void>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Haptics = require('expo-haptics');
  impactAsync = Haptics.impactAsync;
} catch {
  // expo-haptics not available — haptics silently disabled.
}

export interface ShutterButtonProps {
  onPress:     () => void;
  disabled?:   boolean;
  capturing?:  boolean;
}

const INNER_NORMAL   = 64;
const INNER_PRESSED  = 56;
const INNER_HALF     = INNER_NORMAL / 2;

export function ShutterButton({
  onPress,
  disabled  = false,
  capturing = false,
}: ShutterButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const innerSize = scale.interpolate({
    inputRange:  [0, 1],
    outputRange: [INNER_PRESSED, INNER_NORMAL],
  });

  const innerRadius = innerSize.interpolate({
    inputRange:  [INNER_PRESSED, INNER_NORMAL],
    outputRange: [INNER_PRESSED / 2, INNER_HALF],
  });

  function handlePressIn() {
    Animated.spring(scale, {
      toValue:         0,
      useNativeDriver: false,
      speed:           40,
      bounciness:      0,
    }).start();
  }

  function handlePressOut() {
    Animated.spring(scale, {
      toValue:         1,
      useNativeDriver: false,
      speed:           40,
      bounciness:      4,
    }).start();
  }

  async function handlePress() {
    if (disabled) return;
    if (impactAsync) {
      try { await impactAsync('heavy'); } catch { /* ignore */ }
    }
    onPress();
  }

  const innerColor = capturing ? colors.status.error : colors.text.primary;

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityLabel="Take photo"
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: capturing }}
    >
      <View style={[styles.ring, disabled && styles.ringDisabled]}>
        <Animated.View
          style={[
            styles.innerBase,
            {
              width:        innerSize,
              height:       innerSize,
              borderRadius: innerRadius,
              backgroundColor: innerColor,
            },
            disabled && styles.innerDisabled,
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    width:           80,
    height:          80,
    borderRadius:    40,
    borderWidth:     border.thick,
    borderColor:     colors.border.focus,
    alignItems:      'center',
    justifyContent:  'center',
  },
  ringDisabled: {
    borderColor: colors.border.default,
    opacity:     0.5,
  },
  innerBase: {
    // width/height/borderRadius/backgroundColor set via Animated values above.
  },
  innerDisabled: {
    opacity: 0.5,
  },
});

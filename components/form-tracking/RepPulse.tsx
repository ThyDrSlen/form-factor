/**
 * RepPulse
 *
 * Rep completion visual feedback: a short (~300ms) pulse behind the rep
 * counter plus a "+1 Rep" toast that slides up and fades out. Renders
 * children (the live rep counter) so it can be dropped in around any
 * existing rep-count element.
 *
 * The component is controlled by `repCount`. Whenever that value
 * increments by >= 1, a new pulse + toast cycle triggers.
 *
 * Pure UI — caller owns the rep count. No side-effects beyond timers.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { MotiView, AnimatePresence } from 'moti';

export interface RepPulseProps {
  /** Current rep count. Animation triggers when this increments. */
  repCount: number;
  /** The element to pulse (typically the rep counter Text/View). */
  children: React.ReactNode;
  /** Optional container style override. */
  style?: StyleProp<ViewStyle>;
  /** Optional label override for the toast (default "+1 Rep"). */
  toastLabel?: string;
  /** Optional testID for component tests. */
  testID?: string;
}

const PULSE_DURATION_MS = 300;
const TOAST_VISIBLE_MS = 900;

export default function RepPulse({
  repCount,
  children,
  style,
  toastLabel = '+1 Rep',
  testID,
}: RepPulseProps) {
  const previousRef = useRef<number>(repCount);
  const [pulseToken, setPulseToken] = useState<number>(0);
  const [toastVisible, setToastVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (repCount > previousRef.current) {
      previousRef.current = repCount;
      setPulseToken((t) => t + 1);
      setToastVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setToastVisible(false);
        hideTimerRef.current = null;
      }, TOAST_VISIBLE_MS);
    } else if (repCount < previousRef.current) {
      // Reset (e.g., user restarted a set).
      previousRef.current = repCount;
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [repCount]);

  return (
    <View style={[styles.container, style]} testID={testID ?? 'rep-pulse'}>
      <View style={styles.pulseWrapper}>
        <MotiView
          key={pulseToken}
          from={{ opacity: 0.55, scale: 0.9 }}
          animate={{ opacity: 0, scale: 1.65 }}
          transition={{ type: 'timing', duration: PULSE_DURATION_MS }}
          style={styles.pulseRing}
          pointerEvents="none"
        />
        {children}
      </View>

      <AnimatePresence>
        {toastVisible ? (
          <MotiView
            key={`toast-${pulseToken}`}
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -6 }}
            transition={{ type: 'timing', duration: 220 }}
            style={styles.toast}
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${toastLabel} — ${repCount} total`}
            testID="rep-pulse-toast"
          >
            <Text style={styles.toastText} allowFontScaling={false}>
              {toastLabel}
            </Text>
          </MotiView>
        ) : null}
      </AnimatePresence>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: '#3CC8A9',
    backgroundColor: 'rgba(60, 200, 169, 0.18)',
  },
  toast: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(60, 200, 169, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(60, 200, 169, 1)',
  },
  toastText: {
    color: '#0B0F1A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});

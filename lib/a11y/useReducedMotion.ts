/**
 * useReducedMotion
 *
 * Subscribes to the OS `reduceMotionChanged` event and returns the current
 * reduce-motion preference. Callers can pass the result into motion-presets
 * (see `./motion-presets`) to obtain fast-path Moti transitions.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    // Probe initial value.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduced(Boolean(enabled));
        }
      })
      .catch(() => {
        /* silent — default to false */
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        setReduced(Boolean(enabled));
      },
    );

    return () => {
      mounted = false;
      // RN 0.83 returns a subscription object with .remove().
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  return reduced;
}

export default useReducedMotion;

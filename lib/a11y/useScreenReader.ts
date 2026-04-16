/**
 * useScreenReader
 *
 * Returns the current VoiceOver / TalkBack enabled state and subscribes to
 * future changes via `screenReaderChanged`.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useScreenReader(): { isScreenReaderEnabled: boolean } {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (mounted) setEnabled(Boolean(value));
      })
      .catch(() => {
        /* noop */
      });

    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (value) => {
      setEnabled(Boolean(value));
    });

    return () => {
      mounted = false;
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, []);

  return { isScreenReaderEnabled: enabled };
}

export default useScreenReader;

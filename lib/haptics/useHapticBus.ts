/**
 * useHapticBus
 *
 * Returns a stable reference to the module-level haptic bus plus a typed
 * `emit` convenience. Callers that want to react to emitted events (for
 * instance, to play a parallel audio cue) can pass an `onEvent` listener.
 */

import { useCallback, useEffect, useRef } from 'react';
import { hapticBus, type HapticEvent } from './haptic-bus';

export interface UseHapticBusOptions {
  onEvent?: (event: HapticEvent) => void;
}

export function useHapticBus(options?: UseHapticBusOptions) {
  const onEventRef = useRef(options?.onEvent);
  onEventRef.current = options?.onEvent;

  useEffect(() => {
    if (!onEventRef.current) return;
    const unsubscribe = hapticBus.onEvent((event) => {
      onEventRef.current?.(event);
    });
    return unsubscribe;
  }, []);

  const emit = useCallback((event: HapticEvent) => {
    hapticBus.emit(event);
  }, []);

  return {
    emit,
    bus: hapticBus,
  };
}

export default useHapticBus;

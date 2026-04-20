/**
 * MilestoneToastBridge
 *
 * Subscribes to the session-runner event bus and surfaces a toast
 * whenever a `form_milestone` event fires (new PB or week-consistency).
 *
 * Kept as a thin bridge component so the session-runner store can stay
 * pure (no React context deps) and the toast UI stays in React-land.
 * Mount this inside the ToastProvider tree — once, globally — so every
 * screen gets the notification without having to re-subscribe.
 */
import { useEffect } from 'react';

import { useToast } from '@/contexts/ToastContext';
import { subscribeToEvents } from '@/lib/stores/session-runner';

export function MilestoneToastBridge(): null {
  const { show } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      if (event.type !== 'form_milestone') return;
      const message =
        typeof event.payload?.message === 'string' && event.payload.message
          ? event.payload.message
          : 'New form milestone unlocked';
      show(message, { type: 'success', duration: 3500 });
    });
    return unsubscribe;
  }, [show]);

  return null;
}

export default MilestoneToastBridge;

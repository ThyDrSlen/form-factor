/**
 * WatchSessionBridgeContext
 *
 * Mounts {@link initWatchSessionBridge} once per app lifecycle so the watch
 * session event forwarder actually runs in production. The bridge itself is a
 * pure service (see lib/services/watch-session-bridge.ts) — this provider's
 * only job is to call it on mount and clean it up on unmount.
 *
 * There is intentionally no context value: consumers do not interact with the
 * bridge directly. Keeping this as a provider-shaped component lets us slot it
 * into the provider tree the same way every other app-lifecycle wiring is
 * mounted, and gives tests a clean mount/unmount surface.
 *
 * Mount site: inside WorkoutsProvider (the session-aware scope). See
 * contexts/WorkoutsContext.tsx for where children are wrapped.
 *
 * Closes #440 (the bridge service, its tests, and session-runner
 * subscribeToEvents all landed previously; this is the last-mile wiring).
 */

import React, { ReactNode, useEffect } from 'react';
import { initWatchSessionBridge } from '@/lib/services/watch-session-bridge';
import { subscribeToEvents } from '@/lib/stores/session-runner';

export const WatchSessionBridgeProvider = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    const teardown = initWatchSessionBridge({ subscribeToEvents });
    return () => {
      teardown();
    };
  }, []);

  return <>{children}</>;
};

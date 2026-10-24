type MirrorFrame = { frame: string; timestamp?: number } & Record<string, unknown>;

/** Owns one capture at a time; cancellation never retimestamps an old capture. */
export function createWatchMirrorPublisher() {
  let active = false;
  let generation = 0;
  let inFlight = false;
  let lastFrameTimestamp = -Infinity;
  let lastSentAt = 0;

  return {
    setActive(value: boolean) {
      if (active !== value) {
        generation += 1;
        // ARFrame timestamps use system uptime, not a per-session clock.
        // Preserve the watermark so reactivation cannot resend a cached frame.
      }
      active = value;
    },
    async publish(
      capture: () => Promise<MirrorFrame | null>,
      send: (payload: Record<string, unknown>) => void,
    ) {
      if (!active || inFlight) return;
      inFlight = true;
      const captureGeneration = generation;
      const ts = Math.max(Date.now(), lastSentAt + 1);
      const deadline = performance.now() + 1500;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const snapshot = await Promise.race([
          capture(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Watch mirror capture timed out')), 1500);
          }),
        ]);
        // A stalled JS thread can deliver completion before an overdue timer runs.
        if (performance.now() >= deadline) throw new Error('Watch mirror capture timed out');
        if (!active || captureGeneration !== generation || !snapshot?.frame) return;
        if (snapshot.timestamp !== undefined) {
          if (!Number.isFinite(snapshot.timestamp) || snapshot.timestamp <= lastFrameTimestamp) return;
          lastFrameTimestamp = snapshot.timestamp;
        }
        send({ ...snapshot, type: 'mirror', ts });
        lastSentAt = ts;
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    },
  };
}

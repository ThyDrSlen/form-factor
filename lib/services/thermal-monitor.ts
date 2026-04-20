/**
 * thermal-monitor — platform thermal-state reader with adaptive stride.
 *
 * NOTE: `expo-device-info` is NOT currently installed in this project.
 * Rather than pulling a new dependency, this module ships as a stub that
 * always reports 'normal'. The adaptive-FPS machinery below is still
 * wired correctly so a real thermal source can be slotted in later
 * without changing call-sites.
 *
 * When a native bridge for ProcessInfo.thermalState (iOS) or
 * PowerManager.getCurrentThermalStatus (Android) becomes available,
 * replace `readThermalState()` with a real implementation. The rest of
 * the pipeline — ThermalMonitor, FPS buckets, subscriber fan-out — will
 * just start reacting automatically.
 */

export type ThermalState = 'nominal' | 'normal' | 'fair' | 'serious' | 'critical';

export type FpsBucket = 60 | 30 | 15;

export type ThermalSnapshot = {
  state: ThermalState;
  fps: FpsBucket;
  /** Frame stride (in frames dropped per captured frame). 1 = every frame. */
  stride: number;
  /** True if consumers should proactively reduce work. */
  throttled: boolean;
};

export type ThermalListener = (snapshot: ThermalSnapshot) => void;

export type ThermalMonitorOptions = {
  /** Polling cadence (ms) for thermal checks. Default 5000. */
  pollIntervalMs?: number;
  /** Override to inject a custom thermal reader (used by tests). */
  readThermalState?: () => ThermalState | Promise<ThermalState>;
};

const DEFAULT_POLL_MS = 5000;

/**
 * Maps a thermal state to a target FPS. Conservative schedule:
 *   nominal/fair -> 60fps (stride 1)
 *   serious      -> 30fps (stride 2)
 *   critical     -> 15fps (stride 4)
 */
export function fpsForThermalState(state: ThermalState): FpsBucket {
  switch (state) {
    case 'critical':
      return 15;
    case 'serious':
      return 30;
    case 'fair':
    case 'nominal':
    default:
      return 60;
  }
}

export function strideForFps(fps: FpsBucket): number {
  if (fps === 60) return 1;
  if (fps === 30) return 2;
  return 4;
}

export function snapshotFromState(state: ThermalState): ThermalSnapshot {
  const fps = fpsForThermalState(state);
  const stride = strideForFps(fps);
  return {
    state,
    fps,
    stride,
    throttled: state === 'serious' || state === 'critical',
  };
}

/**
 * Default thermal reader. Always returns 'nominal' because
 * `expo-device-info` is not installed. Replace when a real thermal API
 * becomes available without adding a new dependency.
 */
export async function readThermalState(): Promise<ThermalState> {
  return 'nominal';
}

export class ThermalMonitor {
  private readonly pollIntervalMs: number;
  private readonly reader: () => ThermalState | Promise<ThermalState>;
  private readonly listeners = new Set<ThermalListener>();
  private current: ThermalSnapshot = snapshotFromState('nominal');
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options?: ThermalMonitorOptions) {
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.reader = options?.readThermalState ?? readThermalState;
  }

  start(): void {
    if (this.timer || this.disposed) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
  }

  subscribe(listener: ThermalListener): () => void {
    this.listeners.add(listener);
    // Fire immediately so subscribers don't wait for the first tick.
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ThermalSnapshot {
    return this.current;
  }

  /** Force an immediate read. Returns the resulting snapshot. */
  async refresh(): Promise<ThermalSnapshot> {
    await this.tick();
    return this.current;
  }

  private async tick(): Promise<void> {
    try {
      const state = await this.reader();
      const next = snapshotFromState(state);
      const changed =
        next.state !== this.current.state || next.fps !== this.current.fps;
      this.current = next;
      if (changed) {
        this.emit(next);
      }
    } catch {
      // swallow; leave previous snapshot intact
    }
  }

  private emit(snapshot: ThermalSnapshot): void {
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // listeners should not throw; swallow defensively
      }
    });
  }
}

// =============================================================================
// Legacy subscribe API (from #467 visual polish) — kept for consumers that
// don't want the full ThermalMonitor class surface.
// =============================================================================

let __currentThermalState: ThermalState = 'normal';
const __thermalSubscribers = new Set<(state: ThermalState) => void>();

export function getThermalState(): ThermalState {
  return __currentThermalState;
}

export function __setThermalStateForTest(state: ThermalState): void {
  __currentThermalState = state;
  __thermalSubscribers.forEach((cb) => {
    try {
      cb(state);
    } catch {
      /* swallow listener errors */
    }
  });
}

export function subscribeThermalState(cb: (state: ThermalState) => void): () => void {
  __thermalSubscribers.add(cb);
  return () => {
    __thermalSubscribers.delete(cb);
  };
}

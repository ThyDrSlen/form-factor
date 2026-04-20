import { createFrameFeatureRegistry, createInitialBodyState, type BodyState, type FrameFeatureRegistry } from '@/lib/fusion/contracts';

export type FusionMode = 'full' | 'degraded';

/**
 * Maximum age (ms) a cached angle/feature is considered "fresh" for the
 * current frame. 33ms ≈ one frame at 30fps — if pose inference stalls
 * longer than this the rep detector should recompute (or receive a null
 * from getAnglesIfFresh()) rather than silently consuming a stale value.
 *
 * Exposed so downstream consumers (hooks/use-workout-controller) can apply
 * their own staleness policy using `isFusionStateStale()`.
 */
export const FRAME_STALENESS_MS = 33;

export interface FusionEngineState {
  registry: FrameFeatureRegistry;
  frameIndex: number;
  /**
   * Wall-clock timestamp (ms) of the frame whose angles are currently cached
   * in `registry`. `null` when no frame has been processed yet. The
   * FrameFeatureRegistry itself has no timestamp concept — staleness is
   * tracked at this outer layer so the underlying contract stays stable.
   */
  lastFrameTimestampMs: number | null;
  /**
   * Timestamp when the `angles` feature was last populated. Usually identical
   * to `lastFrameTimestampMs` but tracked separately so that frames where
   * `computeAngles` throws / returns empty don't refresh the staleness clock.
   */
  lastAnglesTimestampMs: number | null;
}

export interface FusionFrameContext {
  getAngles: () => Record<string, number>;
  getFeature: <T>(key: string, compute: () => T) => T;
}

export interface FusionFrameInput {
  state: FusionEngineState;
  timestampMs: number;
  cameraConfidence: number;
  computeAngles: () => Record<string, number>;
  computeDerived?: (angles: Record<string, number>) => Record<string, number>;
  cuePasses?: Array<(ctx: FusionFrameContext) => void>;
  /** Override FRAME_STALENESS_MS for this frame if needed. */
  stalenessMs?: number;
  /**
   * Adaptive-FPS stride driven by thermal state. When >1 the engine
   * processes every Nth frame and returns `frameSkipped: true` for the
   * rest, letting hosts drop work without changing call sites.
   *
   *   stride 1 → 60fps (every frame)
   *   stride 2 → 30fps
   *   stride 4 → 15fps
   */
  thermalStride?: number;
}

export interface FusionFrameOutput {
  bodyState: BodyState;
  mode: FusionMode;
  fallbackModeEnabled: boolean;
  /**
   * True when angles served by this frame are older than the staleness
   * threshold. Consumers (rep detector, cue engine) should treat stale
   * angles the same as a missing frame — i.e. freeze or skip, not update
   * state.
   */
  anglesStale: boolean;
  /** Age (ms) of the angles used in this frame. 0 when freshly computed. */
  anglesAgeMs: number;
  /**
   * True when the adaptive-FPS gate dropped this frame. Callers should
   * treat it like a stale frame — skip rep detection / cue updates rather
   * than run them on uncomputed angles.
   */
  frameSkipped: boolean;
  debug: {
    anglesComputeCount: number;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createFusionEngineState(): FusionEngineState {
  return {
    registry: createFrameFeatureRegistry(),
    frameIndex: 0,
    lastFrameTimestampMs: null,
    lastAnglesTimestampMs: null,
  };
}

/**
 * Returns `true` when the angles cached in `state` would be older than
 * `stalenessMs` relative to `nowMs`. Callers can use this before consuming
 * cached angles to short-circuit into a safe no-op.
 */
export function isFusionStateStale(
  state: FusionEngineState,
  nowMs: number,
  stalenessMs: number = FRAME_STALENESS_MS,
): boolean {
  if (state.lastAnglesTimestampMs === null) return true;
  if (!Number.isFinite(nowMs)) return true;
  return nowMs - state.lastAnglesTimestampMs > stalenessMs;
}

/**
 * Returns the cached angles from `state` if they are still fresh relative
 * to `nowMs`, else `null`. Rep-detector / cue-engine consumers should call
 * this and treat `null` as "no signal this frame" rather than reading
 * `state.registry` directly (which would serve stale values).
 */
export function getAnglesIfFresh(
  state: FusionEngineState,
  nowMs: number,
  stalenessMs: number = FRAME_STALENESS_MS,
): Record<string, number> | null {
  if (isFusionStateStale(state, nowMs, stalenessMs)) return null;
  if (!state.registry.has('angles')) return null;
  // Registry's get() accepts a compute fallback; since `has('angles')` is
  // true the compute lambda will never run.
  return state.registry.get('angles', () => ({}));
}

export function runFusionFrame(input: FusionFrameInput): FusionFrameOutput {
  // Decide staleness BEFORE we reset the registry so we can report the age
  // of angles that were served from last frame's cache.
  const stalenessMs = typeof input.stalenessMs === 'number' ? input.stalenessMs : FRAME_STALENESS_MS;
  const preStale = isFusionStateStale(input.state, input.timestampMs, stalenessMs);

  // Adaptive-FPS gate: skip this frame when thermal stride says so. We
  // still bump frameIndex so the stride rhythm is deterministic across
  // skipped / processed frames. No compute runs, cached angles remain
  // in registry, and the output signals frameSkipped=true.
  const thermalStride = Number.isFinite(input.thermalStride) && (input.thermalStride as number) > 1
    ? Math.floor(input.thermalStride as number)
    : 1;
  const nextFrameIndex = input.state.frameIndex + 1;
  if (thermalStride > 1 && nextFrameIndex % thermalStride !== 0) {
    input.state.frameIndex = nextFrameIndex;
    input.state.lastFrameTimestampMs = Number.isFinite(input.timestampMs) ? input.timestampMs : null;
    const mode: FusionMode = input.cameraConfidence < 0.5 ? 'degraded' : 'full';
    const confidence = clamp(mode === 'degraded' ? input.cameraConfidence * 0.75 : input.cameraConfidence, 0, 1);
    const bodyState = createInitialBodyState(input.timestampMs);
    bodyState.confidence = confidence;
    const anglesAgeMs =
      input.state.lastAnglesTimestampMs === null
        ? 0
        : Math.max(0, input.timestampMs - input.state.lastAnglesTimestampMs);
    return {
      bodyState,
      mode,
      fallbackModeEnabled: mode !== 'full',
      anglesStale: preStale,
      anglesAgeMs,
      frameSkipped: true,
      debug: { anglesComputeCount: 0 },
    };
  }

  input.state.registry.reset();
  input.state.frameIndex += 1;
  input.state.lastFrameTimestampMs = Number.isFinite(input.timestampMs) ? input.timestampMs : null;

  let anglesComputeCount = 0;
  let computedThisFrame = false;

  const getAngles = (): Record<string, number> =>
    input.state.registry.get('angles', () => {
      anglesComputeCount += 1;
      computedThisFrame = true;
      const computed = input.computeAngles();
      // Only refresh the staleness clock when compute actually produced a
      // result. If upstream returns empty/{} because inference stalled we
      // leave lastAnglesTimestampMs alone so isStale() keeps reporting true.
      if (computed && Object.keys(computed).length > 0) {
        input.state.lastAnglesTimestampMs = input.state.lastFrameTimestampMs;
      }
      return computed;
    });

  const getFeature = <T>(key: string, compute: () => T): T => input.state.registry.get(key, compute);

  const derived = input.computeDerived
    ? getFeature('derived', () => input.computeDerived!(getAngles()))
    : {};

  if (input.cuePasses && input.cuePasses.length > 0) {
    const context: FusionFrameContext = {
      getAngles,
      getFeature,
    };

    for (const pass of input.cuePasses) {
      pass(context);
    }
  }

  const mode: FusionMode = input.cameraConfidence < 0.5 ? 'degraded' : 'full';
  const confidence = clamp(mode === 'degraded' ? input.cameraConfidence * 0.75 : input.cameraConfidence, 0, 1);

  const bodyState = createInitialBodyState(input.timestampMs);
  bodyState.angles = getAngles();
  bodyState.derived = derived;
  bodyState.confidence = confidence;

  // Staleness only matters if we served from cache (did not recompute). Since
  // registry is reset at the top of every runFusionFrame, `computedThisFrame`
  // is true whenever computeAngles was invoked — meaning fresh. The preStale
  // value reflects whether the PREVIOUS frame's cache was stale as seen at
  // this frame's timestamp, which is the correct signal for downstream
  // consumers looking at `state` between calls.
  const anglesAgeMs =
    computedThisFrame || input.state.lastAnglesTimestampMs === null
      ? 0
      : Math.max(0, input.timestampMs - input.state.lastAnglesTimestampMs);

  return {
    bodyState,
    mode,
    fallbackModeEnabled: mode !== 'full',
    anglesStale: !computedThisFrame && preStale,
    anglesAgeMs,
    frameSkipped: false,
    debug: {
      anglesComputeCount,
    },
  };
}

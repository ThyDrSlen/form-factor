import { createFrameFeatureRegistry, createInitialBodyState, type BodyState, type FrameFeatureRegistry } from '@/lib/fusion/contracts';

export type FusionMode = 'full' | 'degraded';

export interface FusionEngineState {
  registry: FrameFeatureRegistry;
  frameIndex: number;
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
}

export interface FusionFrameOutput {
  bodyState: BodyState;
  mode: FusionMode;
  fallbackModeEnabled: boolean;
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
  };
}

export function runFusionFrame(input: FusionFrameInput): FusionFrameOutput {
  input.state.registry.reset();
  input.state.frameIndex += 1;

  let anglesComputeCount = 0;

  const getAngles = (): Record<string, number> =>
    input.state.registry.get('angles', () => {
      anglesComputeCount += 1;
      return input.computeAngles();
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

  return {
    bodyState,
    mode,
    fallbackModeEnabled: mode !== 'full',
    debug: {
      anglesComputeCount,
    },
  };
}

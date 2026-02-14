import {
  readUseNewTrackingPipelineFlag,
  resolveTrackingPipelineMode,
  getTrackingPipelineFlags,
  getTrackingQualityPipeline,
  EMA_ALPHA_COORD,
  EMA_ALPHA_ANGLE,
  MAX_PX_PER_FRAME,
  SHOW_N_FRAMES,
  HIDE_N_FRAMES,
  HOLD_FRAMES,
  CONFIDENCE_TIER_THRESHOLDS,
} from '../../lib/tracking-quality';

describe('tracking-quality pipeline flag plumbing', () => {
  const originalExpoPublicFlag = process.env.EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE;
  const originalInternalFlag = process.env.USE_NEW_TRACKING_PIPELINE;

  afterEach(() => {
    if (originalExpoPublicFlag === undefined) {
      delete process.env.EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE;
    } else {
      process.env.EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE = originalExpoPublicFlag;
    }

    if (originalInternalFlag === undefined) {
      delete process.env.USE_NEW_TRACKING_PIPELINE;
    } else {
      process.env.USE_NEW_TRACKING_PIPELINE = originalInternalFlag;
    }
  });

  test('uses legacy mode when flag is explicitly false', () => {
    process.env.EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE = 'false';

    const useNew = readUseNewTrackingPipelineFlag();
    const mode = resolveTrackingPipelineMode();
    const flags = getTrackingPipelineFlags();

    expect(useNew).toBe(false);
    expect(mode).toBe('legacy');
    expect(flags).toEqual({ useNewTrackingPipeline: false, mode: 'legacy' });
  });

  test('uses new mode and initializes pipeline state when flag is true', () => {
    process.env.EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE = 'true';

    const useNew = readUseNewTrackingPipelineFlag();
    const mode = resolveTrackingPipelineMode();
    expect(useNew).toBe(true);
    expect(mode).toBe('new');

    const pipeline = getTrackingQualityPipeline();
    expect(pipeline.mode).toBe('new');

    const state = pipeline.createState();
    expect(state).toEqual({ smoothed: null, lastTimestampSec: null });
  });

  test('exports required tracking quality constants', () => {
    expect(EMA_ALPHA_COORD).toBe(0.35);
    expect(EMA_ALPHA_ANGLE).toBe(0.24);
    expect(MAX_PX_PER_FRAME).toBe(36);
    expect(SHOW_N_FRAMES).toBe(2);
    expect(HIDE_N_FRAMES).toBe(3);
    expect(HOLD_FRAMES).toBe(4);
    expect(CONFIDENCE_TIER_THRESHOLDS).toEqual({ low: 0.3, medium: 0.6 });
  });
});

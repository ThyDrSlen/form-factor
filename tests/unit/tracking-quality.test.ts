import {
  EMA_ALPHA_COORD,
  EMA_ALPHA_ANGLE,
  MAX_PX_PER_FRAME,
  SHOW_N_FRAMES,
  HIDE_N_FRAMES,
  HOLD_FRAMES,
  CONFIDENCE_TIER_THRESHOLDS,
} from '../../lib/tracking-quality';

describe('tracking-quality config', () => {
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

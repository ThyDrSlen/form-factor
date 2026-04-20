import { MIN_TOUCH, MIN_TOUCH_HIT_SLOP, hitSlopFor } from '@/lib/a11y/HitTargets';

describe('HitTargets', () => {
  it('exposes MIN_TOUCH at the 44pt Apple HIG minimum', () => {
    expect(MIN_TOUCH).toBe(44);
  });

  it('exposes a symmetric hit-slop object', () => {
    expect(MIN_TOUCH_HIT_SLOP).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  });

  it('returns undefined when the control is already >=44', () => {
    expect(hitSlopFor(44)).toBeUndefined();
    expect(hitSlopFor(60)).toBeUndefined();
  });

  it('expands smaller controls evenly to 44x44', () => {
    const slop = hitSlopFor(32);
    expect(slop).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  });

  it('handles odd deltas by rounding up', () => {
    const slop = hitSlopFor(33);
    expect(slop).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  });
});

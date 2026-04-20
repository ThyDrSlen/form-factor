import {
  getFadeTransition,
  getPulseTransition,
  getSlideTransition,
  REDUCED_TRANSITION,
} from '@/lib/a11y/motion-presets';

describe('motion-presets', () => {
  it('returns reduced transitions when reduce-motion is enabled', () => {
    expect(getPulseTransition(true)).toEqual(REDUCED_TRANSITION);
    expect(getFadeTransition(true)).toEqual(REDUCED_TRANSITION);
    expect(getSlideTransition(true)).toEqual(REDUCED_TRANSITION);
  });

  it('returns a real timing transition when reduce-motion is off (pulse/fade)', () => {
    const pulse = getPulseTransition(false);
    const fade = getFadeTransition(false);
    expect(pulse.type).toBe('timing');
    expect(typeof pulse.duration).toBe('number');
    expect(pulse.duration).toBeGreaterThan(1);
    expect(fade.type).toBe('timing');
    expect(fade.duration).toBeGreaterThan(1);
  });

  it('returns a spring transition for slide when reduce-motion is off', () => {
    const slide = getSlideTransition(false);
    expect(slide.type).toBe('spring');
    expect(slide.stiffness).toBeGreaterThan(0);
  });
});

import {
  getAllPlacementGuides, getPlacementGuide, getPlacementGuideKeys, hasPlacementGuide,
} from '@/lib/services/camera-placement-guide';

describe('curl camera placement', () => {
  it('registers a hips-and-arms guide with optional knees and feet', () => {
    const guide = getPlacementGuide('dumbbell_curl');
    expect(guide).not.toBeNull();
    expect(hasPlacementGuide('dumbbell_curl')).toBe(true);
    expect(getPlacementGuideKeys()).toContain('dumbbell_curl');
    expect(getAllPlacementGuides()).toContainEqual(guide);
    expect(guide?.displayName).toBe('Dumbbell curl');
    expect(guide?.orientation).toBe('portrait');
    expect(guide?.distanceM).toBeGreaterThan(0.5);
    expect(guide?.heightM).toBeGreaterThan(0.5);
    const advice = `${guide?.summary} ${guide?.commonPitfalls.join(' ')}`;
    for (const landmark of ['shoulders', 'elbows', 'wrists', 'hips']) {
      expect(advice.toLowerCase()).toContain(landmark);
    }
    expect(advice).toMatch(/knees and feet (?:can|may) (?:stay|be) out of frame/i);
    expect(advice).not.toMatch(/full.body|head to toes/i);
    expect(guide?.commonPitfalls.length).toBeGreaterThanOrEqual(2);
    expect(guide?.commonPitfalls.length).toBeLessThanOrEqual(3);
  });

  it('preserves other exercises’ lower-body placement advice', () => {
    expect(getPlacementGuide('pushup')?.summary).toBe('Landscape, side view at floor-level, framing head to toes.');
    expect(getPlacementGuide('squat')?.commonPitfalls).toContain('Angled front view hides knee tracking — go 30-45° side on');
    expect(getPlacementGuide('deadlift')?.summary).toBe('Landscape, pure side view, lens near knee height.');
    expect(getPlacementGuide('rdl')?.commonPitfalls).toContain('Bar hides ankle joints — keep camera low');
    expect(getPlacementGuide('unknown_workout')).toBeNull();
  });
});

import { createFrameFeatureRegistry, createInitialBodyState } from '@/lib/fusion/contracts';

describe('fusion contracts', () => {
  test('reuses cached feature values for repeated reads in one frame', () => {
    const registry = createFrameFeatureRegistry();
    let calls = 0;

    const first = registry.get('jointAngles', () => {
      calls += 1;
      return { leftKnee: 92, rightKnee: 90 };
    });

    const second = registry.get('jointAngles', () => {
      calls += 1;
      return { leftKnee: 10, rightKnee: 10 };
    });

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  test('resets cache between frames', () => {
    const registry = createFrameFeatureRegistry();
    let calls = 0;

    registry.get('quality', () => {
      calls += 1;
      return { score: 0.9 };
    });

    registry.reset();

    registry.get('quality', () => {
      calls += 1;
      return { score: 0.8 };
    });

    expect(calls).toBe(2);
  });

  test('creates deterministic initial body state shape', () => {
    const state = createInitialBodyState(1700000000000);

    expect(state.t).toBe(1700000000000);
    expect(state.phase).toBe('setup');
    expect(state.confidence).toBe(0);
    expect(state.cues).toEqual([]);
    expect(state.angles).toEqual({});
    expect(state.derived).toEqual({});
    expect(state.joints3D).toEqual({});
  });
});

import { OcclusionHoldManager, type SustainedOcclusionEvent } from '@/lib/tracking-quality/occlusion';

type J = { x: number; y: number; isTracked: boolean; confidence?: number } | null;
type Frame = Record<string, J>;

function good(): J {
  return { x: 0.5, y: 0.5, isTracked: true, confidence: 0.9 };
}

function missing(): J {
  return null;
}

describe('OcclusionHoldManager sustained telemetry', () => {
  it('fires onSustainedOcclusion after sustainFrames of missing joints', () => {
    const events: SustainedOcclusionEvent[] = [];
    const mgr = new OcclusionHoldManager({
      holdFrames: 60,
      sustainFrames: 3,
      onSustainedOcclusion: (evt) => events.push(evt),
    });

    // Seed with good frame.
    const seed: Frame = { left_hand: good(), right_hand: good() };
    mgr.update(seed);

    // Mark left_hand as missing for 3 frames.
    for (let i = 0; i < 3; i += 1) {
      mgr.update({ left_hand: missing(), right_hand: good() });
    }

    expect(events).toHaveLength(1);
    expect(events[0].jointNames).toContain('left_hand');
    expect(events[0].maxMissingFrames).toBeGreaterThanOrEqual(3);
  });

  it('does not re-fire on same joint set while still occluded', () => {
    const events: SustainedOcclusionEvent[] = [];
    const mgr = new OcclusionHoldManager({
      holdFrames: 60,
      sustainFrames: 2,
      onSustainedOcclusion: (evt) => events.push(evt),
    });
    mgr.update({ left_hand: good() });
    for (let i = 0; i < 6; i += 1) {
      mgr.update({ left_hand: missing() });
    }
    expect(events).toHaveLength(1);
  });

  it('re-fires when a new joint joins the sustained set', () => {
    const events: SustainedOcclusionEvent[] = [];
    const mgr = new OcclusionHoldManager({
      holdFrames: 60,
      sustainFrames: 2,
      onSustainedOcclusion: (evt) => events.push(evt),
    });
    mgr.update({ left_hand: good(), right_hand: good() });

    for (let i = 0; i < 3; i += 1) {
      mgr.update({ left_hand: missing(), right_hand: good() });
    }
    expect(events).toHaveLength(1);

    for (let i = 0; i < 3; i += 1) {
      mgr.update({ left_hand: missing(), right_hand: missing() });
    }
    // right_hand newly sustained -> second event.
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.jointNames).toContain('right_hand');
  });

  it('clears sustained set when joints reappear', () => {
    const events: SustainedOcclusionEvent[] = [];
    const mgr = new OcclusionHoldManager({
      holdFrames: 60,
      sustainFrames: 2,
      onSustainedOcclusion: (evt) => events.push(evt),
    });
    mgr.update({ left_hand: good() });
    mgr.update({ left_hand: missing() });
    mgr.update({ left_hand: missing() });
    expect(mgr.getSustainedOccludedJoints()).toEqual(['left_hand']);
    // Joint recovers.
    mgr.update({ left_hand: good() });
    expect(mgr.getSustainedOccludedJoints()).toEqual([]);
  });

  it('reset clears sustained state', () => {
    const mgr = new OcclusionHoldManager({ holdFrames: 60, sustainFrames: 2 });
    mgr.update({ left_hand: good() });
    mgr.update({ left_hand: missing() });
    mgr.update({ left_hand: missing() });
    expect(mgr.getSustainedOccludedJoints()).toEqual(['left_hand']);
    mgr.reset();
    expect(mgr.getSustainedOccludedJoints()).toEqual([]);
  });

  it('swallows listener errors', () => {
    const mgr = new OcclusionHoldManager({
      holdFrames: 60,
      sustainFrames: 2,
      onSustainedOcclusion: () => {
        throw new Error('boom');
      },
    });
    mgr.update({ left_hand: good() });
    expect(() => {
      mgr.update({ left_hand: missing() });
      mgr.update({ left_hand: missing() });
    }).not.toThrow();
  });
});

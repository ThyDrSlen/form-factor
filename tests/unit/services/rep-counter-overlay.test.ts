import {
  COUNTER_OPACITY_ACTIVE,
  COUNTER_OPACITY_REST,
  computeRepCounterPosition,
  findHipAnchor,
  HIP_JOINT_ALIASES,
  OCCLUSION_CONFIDENCE_THRESHOLD,
} from '@/lib/services/rep-counter-overlay';

const trackedJoint2D = (name: string, x = 0.5, y = 0.5) => ({
  name,
  x,
  y,
  isTracked: true,
});

describe('rep-counter-overlay / findHipAnchor', () => {
  it('returns null when no joints are supplied', () => {
    expect(findHipAnchor({})).toBeNull();
  });

  it('prefers `joints2D` over `joints3D` when both supplied', () => {
    const result = findHipAnchor({
      joints2D: [trackedJoint2D('hips_joint', 0.4, 0.6)],
      joints3D: [{ name: 'hips_joint', x: 0.1, y: 0.1, z: 0, isTracked: true }],
    });
    expect(result).toEqual({ x: 0.4, y: 0.6, isTracked: true, confidence: 1 });
  });

  it('falls back through the alias chain', () => {
    const [, secondAlias] = HIP_JOINT_ALIASES;
    const result = findHipAnchor({ joints2D: [trackedJoint2D(secondAlias, 0.55, 0.45)] });
    expect(result?.x).toBe(0.55);
    expect(result?.y).toBe(0.45);
  });

  it('projects 3D coordinates into 0-1 space when only joints3D supplied', () => {
    const result = findHipAnchor({
      joints3D: [{ name: 'hips_joint', x: 0, y: 0, z: 0, isTracked: true }],
    });
    expect(result?.x).toBeCloseTo(0.5, 3);
    expect(result?.y).toBeCloseTo(0.5, 3);
  });

  it('clamps 3D projections that fall outside 0-1', () => {
    const result = findHipAnchor({
      joints3D: [{ name: 'hips_joint', x: 5, y: -5, z: 0, isTracked: true }],
    });
    expect(result?.x).toBe(1);
    expect(result?.y).toBe(1);
  });
});

describe('rep-counter-overlay / computeRepCounterPosition', () => {
  it('hides when no hip anchor is found', () => {
    const out = computeRepCounterPosition({});
    expect(out.visible).toBe(false);
    expect(out.opacity).toBe(0);
  });

  it('hides when caller-supplied confidence is below threshold', () => {
    const out = computeRepCounterPosition({
      joints2D: [trackedJoint2D('hips_joint')],
      confidence: OCCLUSION_CONFIDENCE_THRESHOLD - 0.1,
    });
    expect(out.visible).toBe(false);
  });

  it('hides when joint isTracked = false', () => {
    const out = computeRepCounterPosition({
      joints2D: [{ name: 'hips_joint', x: 0.5, y: 0.5, isTracked: false }],
    });
    expect(out.visible).toBe(false);
  });

  it('returns active opacity outside rest/idle phases', () => {
    const out = computeRepCounterPosition({
      joints2D: [trackedJoint2D('hips_joint')],
      phase: 'pull',
    });
    expect(out.visible).toBe(true);
    expect(out.opacity).toBe(COUNTER_OPACITY_ACTIVE);
  });

  it('fades during rest phase', () => {
    const out = computeRepCounterPosition({
      joints2D: [trackedJoint2D('hips_joint')],
      phase: 'rest',
    });
    expect(out.visible).toBe(true);
    expect(out.opacity).toBe(COUNTER_OPACITY_REST);
  });

  it('fades during idle phase', () => {
    const out = computeRepCounterPosition({
      joints2D: [trackedJoint2D('hips_joint')],
      phase: 'idle',
    });
    expect(out.opacity).toBe(COUNTER_OPACITY_REST);
  });

  it('respects supplied confidence over the joint-derived proxy', () => {
    const out = computeRepCounterPosition({
      joints2D: [trackedJoint2D('hips_joint')],
      confidence: 0.95,
      phase: 'pull',
    });
    expect(out.visible).toBe(true);
    expect(out.opacity).toBe(COUNTER_OPACITY_ACTIVE);
  });
});

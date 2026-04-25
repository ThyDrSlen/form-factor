import { OcclusionHoldManager } from './occlusion';
import { HOLD_FRAMES } from './config';
import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';

const makeJoint = (overrides: Partial<CanonicalJoint2D> = {}): CanonicalJoint2D => ({
  x: 0.5,
  y: 0.5,
  isTracked: true,
  confidence: 0.9,
  ...overrides,
});

describe('OcclusionHoldManager', () => {
  describe('defaults', () => {
    it('constructs with default options', () => {
      const mgr = new OcclusionHoldManager();
      const out = mgr.update({ head: makeJoint() });
      expect(out.head).toBeDefined();
    });

    it('honors custom holdFrames option', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 2 });
      mgr.update({ head: makeJoint() });
      // Missing frame #1
      let result = mgr.update({});
      expect(result.head).toBeTruthy();
      // Missing frame #2
      result = mgr.update({});
      expect(result.head).toBeTruthy();
      // Missing frame #3 — exceeds holdFrames, should drop
      result = mgr.update({});
      expect(result.head).toBeNull();
    });
  });

  describe('Record (plain object) input', () => {
    it('passes through visible joints unchanged (apart from confidence clamp)', () => {
      const mgr = new OcclusionHoldManager();
      const out = mgr.update({
        head: makeJoint({ x: 0.1, y: 0.2, confidence: 0.95 }),
      });
      expect(out.head).toEqual({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.95 });
    });

    it('clamps confidence > 1 to 1', () => {
      const mgr = new OcclusionHoldManager();
      const out = mgr.update({ head: makeJoint({ confidence: 1.5 }) });
      expect(out.head?.confidence).toBe(1);
    });

    it('returns null for a never-seen missing joint', () => {
      const mgr = new OcclusionHoldManager();
      const out = mgr.update({ head: null });
      expect(out.head).toBeNull();
    });

    it('holds last good position when joint becomes untracked mid-session', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 5, decayFactorPerFrame: 0.9 });
      mgr.update({ head: makeJoint({ x: 0.4, y: 0.4, confidence: 0.9 }) });
      const out = mgr.update({ head: null });
      expect(out.head).toEqual({
        x: 0.4,
        y: 0.4,
        isTracked: true,
        confidence: expect.any(Number),
      });
      // confidence should have decayed by factor 0.9
      expect(out.head!.confidence).toBeCloseTo(0.9 * 0.9, 5);
    });

    it('decays confidence geometrically per missing frame', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 10, decayFactorPerFrame: 0.5 });
      mgr.update({ head: makeJoint({ confidence: 1 }) });
      const r1 = mgr.update({});
      const r2 = mgr.update({});
      const r3 = mgr.update({});
      expect(r1.head!.confidence).toBeCloseTo(0.5, 5);
      expect(r2.head!.confidence).toBeCloseTo(0.25, 5);
      expect(r3.head!.confidence).toBeCloseTo(0.125, 5);
    });

    it('drops joint after holdFrames exceeded', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 2 });
      mgr.update({ head: makeJoint() });
      mgr.update({});
      mgr.update({});
      const out = mgr.update({});
      expect(out.head).toBeNull();

      // Subsequent update should confirm joint is fully gone (no key emitted)
      const out2 = mgr.update({});
      expect(out2.head).toBeUndefined();
    });

    it('resets hold when joint reappears visible', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 5 });
      mgr.update({ head: makeJoint({ x: 0.1, y: 0.1 }) });
      mgr.update({});
      mgr.update({});
      const r = mgr.update({ head: makeJoint({ x: 0.5, y: 0.5 }) });
      expect(r.head!.x).toBe(0.5);

      // Now miss one frame — confidence reflects fresh start, not cumulative
      const missing = mgr.update({});
      expect(missing.head!.x).toBe(0.5);
      expect(missing.head!.confidence).toBeCloseTo(0.9 * 0.85, 5);
    });
  });

  describe('CanonicalJointMap input', () => {
    it('returns a Map when given a Map', () => {
      const mgr = new OcclusionHoldManager();
      const joints: CanonicalJointMap = new Map([['head', makeJoint()]]);
      const out = mgr.update(joints);
      expect(out).toBeInstanceOf(Map);
      expect((out as CanonicalJointMap).get('head')).toBeDefined();
    });

    it('omits never-seen missing joints from the output Map', () => {
      const mgr = new OcclusionHoldManager();
      const out = mgr.update(new Map()) as CanonicalJointMap;
      expect(out.size).toBe(0);
    });

    it('holds last-good for missing Map joints until holdFrames', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 2 });
      const initial: CanonicalJointMap = new Map([['head', makeJoint({ x: 0.2, y: 0.3, confidence: 0.8 })]]);
      mgr.update(initial);

      const out = mgr.update(new Map()) as CanonicalJointMap;
      expect(out.get('head')).toMatchObject({ x: 0.2, y: 0.3, isTracked: true });

      mgr.update(new Map());
      const out2 = mgr.update(new Map()) as CanonicalJointMap;
      // exceeded holdFrames → dropped
      expect(out2.has('head')).toBe(false);
    });
  });

  describe('visibility thresholding', () => {
    it('treats joint below minConfidence as missing', () => {
      const mgr = new OcclusionHoldManager({ minConfidence: 0.5 });
      mgr.update({ head: makeJoint({ confidence: 0.9 }) });
      // Next frame joint exists but confidence too low
      const out = mgr.update({ head: makeJoint({ confidence: 0.2 }) });
      // Treated as missing → hold kicks in
      expect(out.head).toBeTruthy();
      expect(out.head!.confidence).toBeLessThan(0.9);
    });

    it('treats untracked joint as missing', () => {
      const mgr = new OcclusionHoldManager();
      mgr.update({ head: makeJoint({ confidence: 0.9 }) });
      const out = mgr.update({ head: makeJoint({ isTracked: false, confidence: 0.9 }) });
      // Not tracked → hold kicks in
      expect(out.head).toBeTruthy();
      expect(out.head!.confidence).toBeLessThan(0.9);
    });
  });

  describe('reset()', () => {
    it('clears all held joints', () => {
      const mgr = new OcclusionHoldManager({ holdFrames: 5 });
      mgr.update({ head: makeJoint(), shoulder: makeJoint() });
      mgr.update({}); // now in hold
      mgr.reset();
      const out = mgr.update({});
      // With no holds and no incoming keys, output is empty
      expect(out.head).toBeUndefined();
      expect(out.shoulder).toBeUndefined();
    });
  });

  describe('default HOLD_FRAMES constant', () => {
    it('matches config export', () => {
      expect(typeof HOLD_FRAMES).toBe('number');
      expect(HOLD_FRAMES).toBeGreaterThan(0);
    });
  });
});

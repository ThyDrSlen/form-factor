import {
  getConfidenceTier,
  getVisibilityTier,
  isJointVisible,
  areRequiredJointsVisible,
  PULLUP_CRITICAL_JOINTS,
  is_joint_visible,
  required_joints_visible,
} from './visibility';
import { CONFIDENCE_TIER_THRESHOLDS } from './config';
import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';

const makeJoint = (overrides: Partial<CanonicalJoint2D> = {}): CanonicalJoint2D => ({
  x: 0.5,
  y: 0.5,
  isTracked: true,
  confidence: 0.9,
  ...overrides,
});

describe('visibility tier helpers', () => {
  describe('getConfidenceTier boundary precision', () => {
    it('returns "low" below the low threshold', () => {
      expect(getConfidenceTier(0)).toBe('low');
      expect(getConfidenceTier(CONFIDENCE_TIER_THRESHOLDS.low - 0.0001)).toBe('low');
    });

    it('returns "medium" at the low threshold (inclusive)', () => {
      expect(getConfidenceTier(CONFIDENCE_TIER_THRESHOLDS.low)).toBe('medium');
    });

    it('returns "medium" below the medium threshold', () => {
      expect(getConfidenceTier(CONFIDENCE_TIER_THRESHOLDS.medium - 0.0001)).toBe('medium');
    });

    it('returns "high" at the medium threshold (inclusive)', () => {
      expect(getConfidenceTier(CONFIDENCE_TIER_THRESHOLDS.medium)).toBe('high');
    });

    it('returns "high" at and above 1', () => {
      expect(getConfidenceTier(1)).toBe('high');
      expect(getConfidenceTier(5)).toBe('high'); // clamp01 clamps above 1
    });

    it('treats negative / NaN as 0 (low)', () => {
      expect(getConfidenceTier(-1)).toBe('low');
      expect(getConfidenceTier(NaN)).toBe('low');
    });
  });

  describe('getVisibilityTier', () => {
    it('maps high → trusted', () => {
      expect(getVisibilityTier(1)).toBe('trusted');
    });
    it('maps medium → weak', () => {
      expect(getVisibilityTier((CONFIDENCE_TIER_THRESHOLDS.low + CONFIDENCE_TIER_THRESHOLDS.medium) / 2)).toBe('weak');
    });
    it('maps low → missing', () => {
      expect(getVisibilityTier(0.1)).toBe('missing');
    });
  });
});

describe('isJointVisible', () => {
  it('returns false for null or undefined joints', () => {
    expect(isJointVisible(null)).toBe(false);
    expect(isJointVisible(undefined)).toBe(false);
  });

  it('returns false when isTracked is false', () => {
    expect(isJointVisible(makeJoint({ isTracked: false }))).toBe(false);
  });

  it('returns true when tracked and confidence >= min', () => {
    expect(isJointVisible(makeJoint({ confidence: 0.5 }), 0.3)).toBe(true);
  });

  it('returns false when tracked but confidence below min', () => {
    expect(isJointVisible(makeJoint({ confidence: 0.1 }), 0.5)).toBe(false);
  });

  it('returns true when tracked with no confidence field', () => {
    expect(isJointVisible({ x: 0, y: 0, isTracked: true })).toBe(true);
  });

  it('uses default min threshold from config', () => {
    // confidence equal to the default min → visible (>= comparison)
    expect(isJointVisible(makeJoint({ confidence: CONFIDENCE_TIER_THRESHOLDS.low }))).toBe(true);
    expect(
      isJointVisible(makeJoint({ confidence: CONFIDENCE_TIER_THRESHOLDS.low - 0.01 })),
    ).toBe(false);
  });

  it('is exported as snake_case alias', () => {
    expect(is_joint_visible).toBe(isJointVisible);
  });
});

describe('areRequiredJointsVisible', () => {
  describe('null inputs', () => {
    it('returns false for null joints', () => {
      expect(areRequiredJointsVisible(null, ['head'])).toBe(false);
    });
    it('returns false for undefined joints', () => {
      expect(areRequiredJointsVisible(undefined, ['head'])).toBe(false);
    });
  });

  describe('single-key required', () => {
    it('returns true when single required joint is visible', () => {
      expect(
        areRequiredJointsVisible({ head: makeJoint() }, ['head']),
      ).toBe(true);
    });
    it('returns false when single required joint is missing', () => {
      expect(
        areRequiredJointsVisible({ head: null }, ['head']),
      ).toBe(false);
    });
  });

  describe('alternative-joint OR list', () => {
    it('passes when ANY alternative joint is visible (first option present)', () => {
      expect(
        areRequiredJointsVisible(
          { left_shoulder: makeJoint() },
          [['left_shoulder', 'left_shoulder_1_joint']],
        ),
      ).toBe(true);
    });

    it('passes when first alternative missing but second present', () => {
      expect(
        areRequiredJointsVisible(
          { left_shoulder: null, left_shoulder_1_joint: makeJoint() },
          [['left_shoulder', 'left_shoulder_1_joint']],
        ),
      ).toBe(true);
    });

    it('fails when all alternatives are missing', () => {
      expect(
        areRequiredJointsVisible(
          { left_shoulder: null, left_shoulder_1_joint: null },
          [['left_shoulder', 'left_shoulder_1_joint']],
        ),
      ).toBe(false);
    });
  });

  describe('Map vs object input', () => {
    it('produces identical result for Map and Record with same data', () => {
      const record = {
        head: makeJoint({ confidence: 0.7 }),
        left_shoulder_1_joint: makeJoint({ confidence: 0.4 }),
      };
      const map: CanonicalJointMap = new Map<string, CanonicalJoint2D>([
        ['head', record.head],
        ['left_shoulder_1_joint', record.left_shoulder_1_joint!],
      ]);

      const spec = ['head', ['left_shoulder', 'left_shoulder_1_joint']] as Parameters<typeof areRequiredJointsVisible>[1];
      expect(areRequiredJointsVisible(record, spec)).toBe(areRequiredJointsVisible(map, spec));
    });
  });

  describe('PULLUP_CRITICAL_JOINTS preset', () => {
    it('passes when all four groups have at least one member visible', () => {
      const joints = {
        left_shoulder: makeJoint(),
        right_shoulder_1_joint: makeJoint(),
        left_forearm: makeJoint(),
        right_elbow: makeJoint(),
      };
      expect(areRequiredJointsVisible(joints, PULLUP_CRITICAL_JOINTS)).toBe(true);
    });

    it('fails when a required elbow group has no visible joint', () => {
      const joints = {
        left_shoulder: makeJoint(),
        right_shoulder: makeJoint(),
        left_elbow: null,
        left_forearm: null,
        left_forearm_joint: null,
        right_elbow: makeJoint(),
      };
      expect(areRequiredJointsVisible(joints, PULLUP_CRITICAL_JOINTS)).toBe(false);
    });
  });

  it('exports snake_case alias', () => {
    expect(required_joints_visible).toBe(areRequiredJointsVisible);
  });
});

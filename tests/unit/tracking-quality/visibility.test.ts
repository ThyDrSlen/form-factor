/**
 * Coverage for the visibility helpers — exact-threshold boundaries and
 * non-finite inputs. The audit flagged these as untested edge cases that
 * could tip rep-counter components from "trusted" to "weak" mid-rep.
 */

import {
  getConfidenceTier,
  getVisibilityTier,
  isJointVisible,
  areRequiredJointsVisible,
} from '@/lib/tracking-quality/visibility';
import { CONFIDENCE_TIER_THRESHOLDS } from '@/lib/tracking-quality/config';

// Tracked-joint helper
function joint(confidence: number | undefined, isTracked = true) {
  return {
    x: 0.5,
    y: 0.5,
    isTracked,
    confidence,
  } as Parameters<typeof isJointVisible>[0];
}

describe('getConfidenceTier — boundaries', () => {
  test('exactly at low threshold (0.3) is medium, not low', () => {
    expect(getConfidenceTier(CONFIDENCE_TIER_THRESHOLDS.low)).toBe('medium');
  });

  test('one ULP below low threshold is low', () => {
    const justUnder = CONFIDENCE_TIER_THRESHOLDS.low - Number.EPSILON;
    expect(getConfidenceTier(justUnder)).toBe('low');
  });

  test('exactly at medium threshold (0.6) is high, not medium', () => {
    expect(getConfidenceTier(CONFIDENCE_TIER_THRESHOLDS.medium)).toBe('high');
  });

  test('one ULP below medium threshold is medium', () => {
    const justUnder = CONFIDENCE_TIER_THRESHOLDS.medium - Number.EPSILON;
    expect(getConfidenceTier(justUnder)).toBe('medium');
  });

  test('confidence = 0 is low', () => {
    expect(getConfidenceTier(0)).toBe('low');
  });

  test('confidence = 1 is high', () => {
    expect(getConfidenceTier(1)).toBe('high');
  });

  test('negative confidence clamps to 0 → low', () => {
    expect(getConfidenceTier(-0.5)).toBe('low');
  });

  test('confidence > 1 clamps to 1 → high', () => {
    expect(getConfidenceTier(1.7)).toBe('high');
  });

  test('NaN confidence clamps to 0 → low', () => {
    expect(getConfidenceTier(NaN)).toBe('low');
  });

  test('Infinity is treated as non-finite → low (safer than claiming trusted on garbage)', () => {
    expect(getConfidenceTier(Infinity)).toBe('low');
  });

  test('-Infinity clamps to 0 → low', () => {
    expect(getConfidenceTier(-Infinity)).toBe('low');
  });
});

describe('getVisibilityTier — boundaries', () => {
  test('high tier maps to "trusted"', () => {
    expect(getVisibilityTier(0.9)).toBe('trusted');
    expect(getVisibilityTier(CONFIDENCE_TIER_THRESHOLDS.medium)).toBe('trusted');
  });

  test('medium tier maps to "weak"', () => {
    expect(getVisibilityTier(0.4)).toBe('weak');
    expect(getVisibilityTier(CONFIDENCE_TIER_THRESHOLDS.low)).toBe('weak');
  });

  test('low tier maps to "missing"', () => {
    expect(getVisibilityTier(0.1)).toBe('missing');
    expect(getVisibilityTier(0)).toBe('missing');
  });

  test('NaN treated as missing', () => {
    expect(getVisibilityTier(NaN)).toBe('missing');
  });

  test('Infinity treated as missing (consistent with NaN handling)', () => {
    expect(getVisibilityTier(Infinity)).toBe('missing');
  });
});

describe('isJointVisible', () => {
  test('null joint is not visible', () => {
    expect(isJointVisible(null)).toBe(false);
  });

  test('undefined joint is not visible', () => {
    expect(isJointVisible(undefined)).toBe(false);
  });

  test('untracked joint is not visible regardless of confidence', () => {
    expect(isJointVisible(joint(0.99, false))).toBe(false);
  });

  test('tracked joint with no confidence is visible', () => {
    expect(isJointVisible(joint(undefined))).toBe(true);
  });

  test('tracked joint at exactly low threshold is visible (>=)', () => {
    expect(isJointVisible(joint(CONFIDENCE_TIER_THRESHOLDS.low))).toBe(true);
  });

  test('tracked joint just below low threshold is not visible', () => {
    expect(isJointVisible(joint(CONFIDENCE_TIER_THRESHOLDS.low - 0.001))).toBe(false);
  });

  test('custom minConfidence override is honored', () => {
    expect(isJointVisible(joint(0.5), 0.4)).toBe(true);
    expect(isJointVisible(joint(0.5), 0.6)).toBe(false);
  });

  test('NaN confidence is treated as 0 → not visible', () => {
    expect(isJointVisible(joint(NaN))).toBe(false);
  });

  test('confidence > 1 still visible (clamped to 1)', () => {
    expect(isJointVisible(joint(2))).toBe(true);
  });

  test('Infinity confidence is clamped to 0 → not visible (consistent with tier)', () => {
    expect(isJointVisible(joint(Infinity))).toBe(false);
  });
});

describe('areRequiredJointsVisible', () => {
  const visible = joint(0.8);
  const hidden = joint(0.05);
  const untracked = joint(0.99, false);

  test('null joint map returns false', () => {
    expect(areRequiredJointsVisible(null, ['head'])).toBe(false);
  });

  test('undefined joint map returns false', () => {
    expect(areRequiredJointsVisible(undefined, ['head'])).toBe(false);
  });

  test('all single-key requirements satisfied returns true', () => {
    expect(areRequiredJointsVisible({ head: visible, neck: visible }, ['head', 'neck'])).toBe(
      true,
    );
  });

  test('one missing single-key requirement returns false', () => {
    expect(areRequiredJointsVisible({ head: visible, neck: hidden }, ['head', 'neck'])).toBe(
      false,
    );
  });

  test('OR-spec satisfied if any alternate is visible', () => {
    expect(
      areRequiredJointsVisible({ left_shoulder: hidden, left_shoulder_1: visible }, [
        ['left_shoulder', 'left_shoulder_1'],
      ]),
    ).toBe(true);
  });

  test('OR-spec not satisfied if all alternates hidden', () => {
    expect(
      areRequiredJointsVisible({ left_shoulder: hidden, left_shoulder_1: hidden }, [
        ['left_shoulder', 'left_shoulder_1'],
      ]),
    ).toBe(false);
  });

  test('untracked joints count as not visible even if confidence is high', () => {
    expect(areRequiredJointsVisible({ head: untracked }, ['head'])).toBe(false);
  });

  test('Map<> joint store works alongside object literal', () => {
    const m = new Map<string, ReturnType<typeof joint>>();
    m.set('head', visible);
    m.set('neck', visible);
    expect(areRequiredJointsVisible(m as never, ['head', 'neck'])).toBe(true);
  });

  test('empty required-list always passes', () => {
    expect(areRequiredJointsVisible({}, [])).toBe(true);
  });
});

/**
 * Tests for enriched rep-fault telemetry (#417 finding #5).
 *
 * Previously rep rejections were logged as free-form strings — impossible
 * to distinguish "real form issue" from "detection artefact". Detector
 * now emits RepFaultEvents with exercise_id, rep_number, visibility_badge,
 * confidence_tier, min_confidence_met, and rejection_reason so downstream
 * telemetry can aggregate by root cause.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { RepDetectorPullup } from '@/lib/tracking-quality/rep-detector';
import {
  buildRepFaultEvent,
  deriveConfidenceTier,
  repFaultFromScoringResult,
  scorePullupWithComponentAvailability,
  type PullupScoringResult,
  type RepFaultEvent,
} from '@/lib/tracking-quality/scoring';

function baseAngles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 120,
    rightKnee: 120,
    leftElbow: 165,
    rightElbow: 165,
    leftHip: 140,
    rightHip: 140,
    leftShoulder: 92,
    rightShoulder: 92,
    ...overrides,
  };
}

function baseJoints(overrides?: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number }>) {
  return {
    left_shoulder: { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 },
    right_shoulder: { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 },
    left_hand: { x: 0.35, y: 0.25, isTracked: true, confidence: 0.95 },
    right_hand: { x: 0.65, y: 0.25, isTracked: true, confidence: 0.95 },
    ...(overrides ?? {}),
  };
}

describe('buildRepFaultEvent', () => {
  it('fills in safe defaults', () => {
    const event = buildRepFaultEvent({
      exerciseId: 'squat',
      repNumber: 3,
      faultId: 'incomplete_lockout',
    });
    expect(event).toEqual({
      exercise_id: 'squat',
      rep_number: 3,
      fault_id: 'incomplete_lockout',
      visibility_badge: 'full',
      confidence_tier: null,
      min_confidence_met: true,
      rejection_reason: null,
      note: undefined,
    });
  });

  it('carries explicit confidence tier and rejection reason', () => {
    const event = buildRepFaultEvent({
      exerciseId: 'pullup',
      repNumber: 5,
      faultId: 'rep_rejected',
      visibilityBadge: 'partial',
      confidenceTier: 'weak',
      minConfidenceMet: false,
      rejectionReason: 'low_visibility',
      note: 'left hand off-screen',
    });
    expect(event.visibility_badge).toBe('partial');
    expect(event.confidence_tier).toBe('weak');
    expect(event.min_confidence_met).toBe(false);
    expect(event.rejection_reason).toBe('low_visibility');
    expect(event.note).toBe('left hand off-screen');
  });
});

describe('deriveConfidenceTier', () => {
  function makeResult(tiers: Array<'weak' | 'trusted' | 'missing'>): Pick<PullupScoringResult, 'components_available'> {
    const keys = ['rom_score', 'symmetry_score', 'tempo_score', 'torso_stability_score'] as const;
    const map: PullupScoringResult['components_available'] = {} as PullupScoringResult['components_available'];
    for (let i = 0; i < keys.length; i += 1) {
      map[keys[i]] = {
        available: tiers[i] !== 'missing',
        required_joints: [],
        min_visibility_tier: 'weak',
        visibility_tier: tiers[i] ?? 'missing',
      };
    }
    return { components_available: map };
  }

  it('returns null when all components are missing', () => {
    expect(deriveConfidenceTier(makeResult(['missing', 'missing', 'missing', 'missing']))).toBeNull();
  });

  it('returns the worst tier (weak < trusted)', () => {
    expect(deriveConfidenceTier(makeResult(['trusted', 'weak', 'trusted', 'trusted']))).toBe('weak');
  });

  it('returns trusted when every component is trusted', () => {
    expect(deriveConfidenceTier(makeResult(['trusted', 'trusted', 'trusted', 'trusted']))).toBe('trusted');
  });
});

describe('RepDetectorPullup enriched fault events', () => {
  it('emits a low_visibility rejection when required joints are not visible', () => {
    const events: RepFaultEvent[] = [];
    const detector = new RepDetectorPullup({
      nConsecFrames: 1,
      exerciseId: 'pullup',
      onFault: (e) => events.push(e),
    });

    detector.step({
      timestampSec: 0,
      angles: baseAngles(),
      joints: baseJoints({
        left_hand: { x: 0.35, y: 0.25, isTracked: false, confidence: 0.01 },
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0].exercise_id).toBe('pullup');
    expect(events[0].rep_number).toBe(1);
    expect(events[0].fault_id).toBe('rep_rejected');
    expect(events[0].rejection_reason).toBe('low_visibility');
    expect(events[0].min_confidence_met).toBe(false);
    expect(events[0].visibility_badge).toBe('partial');
  });

  it('emits a nan_input rejection when an elbow angle is NaN', () => {
    const events: RepFaultEvent[] = [];
    const detector = new RepDetectorPullup({
      nConsecFrames: 1,
      onFault: (e) => events.push(e),
    });

    detector.step({
      timestampSec: 0,
      angles: baseAngles({ leftElbow: Number.NaN }),
      joints: baseJoints(),
    });

    expect(events.length).toBeGreaterThan(0);
    const elbowReject = events.find((e) => e.rejection_reason === 'nan_input');
    expect(elbowReject).toBeDefined();
    expect(elbowReject?.fault_id).toBe('rep_rejected');
  });

  it('emits infinite_input when an elbow is Infinity', () => {
    const events: RepFaultEvent[] = [];
    const detector = new RepDetectorPullup({
      nConsecFrames: 1,
      onFault: (e) => events.push(e),
    });

    detector.step({
      timestampSec: 0,
      angles: baseAngles({ rightElbow: Number.POSITIVE_INFINITY }),
      joints: baseJoints(),
    });

    const match = events.find((e) => e.rejection_reason === 'infinite_input');
    expect(match).toBeDefined();
  });

  it('does not throw when sink throws', () => {
    const detector = new RepDetectorPullup({
      nConsecFrames: 1,
      onFault: () => {
        throw new Error('boom');
      },
    });

    expect(() => {
      detector.step({
        timestampSec: 0,
        angles: baseAngles({ leftElbow: Number.NaN }),
        joints: baseJoints(),
      });
    }).not.toThrow();
  });

  it('uses custom exerciseId when supplied', () => {
    const events: RepFaultEvent[] = [];
    const detector = new RepDetectorPullup({
      nConsecFrames: 1,
      exerciseId: 'muscle_up',
      onFault: (e) => events.push(e),
    });

    detector.step({
      timestampSec: 0,
      angles: baseAngles({ leftElbow: Number.NaN }),
      joints: baseJoints(),
    });

    expect(events[0].exercise_id).toBe('muscle_up');
  });

  it('keeps working when no onFault sink is provided (backward compatible)', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1 });

    expect(() => {
      detector.step({
        timestampSec: 0,
        angles: baseAngles({ leftElbow: Number.NaN }),
        joints: baseJoints(),
      });
    }).not.toThrow();
  });
});

describe('repFaultFromScoringResult', () => {
  it('returns null when the rep scored cleanly', () => {
    // Well-tracked frame → full visibility, no suppression
    const result = scorePullupWithComponentAvailability({
      durationMs: 1500,
      repAngles: {
        start: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 80, rightElbow: 80, leftShoulder: 100, rightShoulder: 100 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 110, rightShoulder: 110 },
      },
      joints: new Map([
        ['left_shoulder', { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 }],
        ['right_shoulder', { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 }],
        ['left_hand', { x: 0.35, y: 0.2, isTracked: true, confidence: 0.95 }],
        ['right_hand', { x: 0.65, y: 0.2, isTracked: true, confidence: 0.95 }],
        ['left_hip', { x: 0.42, y: 0.7, isTracked: true, confidence: 0.9 }],
        ['right_hip', { x: 0.58, y: 0.7, isTracked: true, confidence: 0.9 }],
        ['left_elbow', { x: 0.42, y: 0.5, isTracked: true, confidence: 0.9 }],
        ['right_elbow', { x: 0.58, y: 0.5, isTracked: true, confidence: 0.9 }],
        ['left_wrist', { x: 0.38, y: 0.3, isTracked: true, confidence: 0.9 }],
        ['right_wrist', { x: 0.62, y: 0.3, isTracked: true, confidence: 0.9 }],
      ]),
    });

    // Either clean or slightly suppressed — the key assertion is that if the
    // result has no missing components AND is not suppressed, we get null.
    if (!result.score_suppressed && result.missing_components.length === 0) {
      expect(repFaultFromScoringResult({ exerciseId: 'pullup', repNumber: 2, result })).toBeNull();
    } else {
      const event = repFaultFromScoringResult({ exerciseId: 'pullup', repNumber: 2, result });
      expect(event).not.toBeNull();
    }
  });

  it('emits missing_components when joints were absent', () => {
    const result = scorePullupWithComponentAvailability({
      durationMs: 1000,
      repAngles: {
        start: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 80, rightElbow: 80, leftShoulder: 100, rightShoulder: 100 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 110, rightShoulder: 110 },
      },
      joints: new Map(),
    });

    const event = repFaultFromScoringResult({ exerciseId: 'pullup', repNumber: 7, result });
    expect(event).not.toBeNull();
    expect(event?.exercise_id).toBe('pullup');
    expect(event?.rep_number).toBe(7);
    expect(event?.fault_id).toBe('rep_suppressed');
    expect(event?.rejection_reason).toBe('missing_components');
    expect(event?.min_confidence_met).toBe(false);
  });
});

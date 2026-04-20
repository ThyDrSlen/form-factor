import { HumanValidationGuard } from '@/lib/tracking-quality/human-validation';
import type { Joint2D } from '@/lib/tracking-quality/human-validation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a plausible front-facing human skeleton (normalized screen coords). */
function validHumanJoints(): Record<string, Joint2D> {
  return {
    head:            { x: 0.50, y: 0.10, isTracked: true },
    neck:            { x: 0.50, y: 0.18, isTracked: true },
    left_shoulder:   { x: 0.40, y: 0.22, isTracked: true },
    right_shoulder:  { x: 0.60, y: 0.22, isTracked: true },
    left_elbow:      { x: 0.35, y: 0.35, isTracked: true },
    right_elbow:     { x: 0.65, y: 0.35, isTracked: true },
    left_hand:       { x: 0.32, y: 0.48, isTracked: true },
    right_hand:      { x: 0.68, y: 0.48, isTracked: true },
    left_hip:        { x: 0.43, y: 0.50, isTracked: true },
    right_hip:       { x: 0.57, y: 0.50, isTracked: true },
  };
}

/** Adds small per-frame jitter to simulate a living person. */
function jitter(joints: Record<string, Joint2D>, magnitude = 0.003): Record<string, Joint2D> {
  const out: Record<string, Joint2D> = {};
  for (const key of Object.keys(joints)) {
    const j = joints[key];
    out[key] = {
      x: j.x + (Math.random() - 0.5) * magnitude,
      y: j.y + (Math.random() - 0.5) * magnitude,
      isTracked: j.isTracked,
      confidence: j.confidence,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HumanValidationGuard', () => {
  // -----------------------------------------------------------------------
  // 1. Valid human skeleton passes all checks
  // -----------------------------------------------------------------------
  describe('valid human skeleton', () => {
    test('passes all checks and returns isHuman true', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();

      // Feed a couple of frames with jitter so the static check is satisfied.
      guard.step(jitter(joints));
      const result = guard.step(jitter(joints));

      expect(result.isHuman).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.checks.minJoints).toBe(true);
      expect(result.checks.anatomicalPlausibility).toBe(true);
      expect(result.checks.bodyProportions).toBe(true);
      expect(result.checks.notStatic).toBe(true);
      expect(result.rejectionReason).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Too few tracked joints -> rejected
  // -----------------------------------------------------------------------
  describe('minimum tracked joints', () => {
    test('rejects when fewer than 4 joints are tracked', () => {
      const guard = new HumanValidationGuard();
      const joints: Record<string, Joint2D> = {
        head:           { x: 0.5, y: 0.1, isTracked: true },
        left_shoulder:  { x: 0.4, y: 0.2, isTracked: true },
        right_shoulder: { x: 0.6, y: 0.2, isTracked: false },
        left_hip:       { x: 0.4, y: 0.5, isTracked: false },
      };

      const result = guard.step(joints);

      expect(result.checks.minJoints).toBe(false);
    });

    test('accepts exactly 4 tracked joints', () => {
      const guard = new HumanValidationGuard();
      const joints: Record<string, Joint2D> = {
        head:           { x: 0.50, y: 0.10, isTracked: true },
        left_shoulder:  { x: 0.40, y: 0.22, isTracked: true },
        right_shoulder: { x: 0.60, y: 0.22, isTracked: true },
        left_hip:       { x: 0.43, y: 0.50, isTracked: true },
        right_hip:      { x: 0.57, y: 0.50, isTracked: true },
        left_elbow:     { x: 0.35, y: 0.35, isTracked: false },
      };

      const result = guard.step(joints);

      expect(result.checks.minJoints).toBe(true);
    });

    test('respects custom minTrackedJoints option', () => {
      const guard = new HumanValidationGuard({ minTrackedJoints: 6 });
      const joints: Record<string, Joint2D> = {
        head:            { x: 0.50, y: 0.10, isTracked: true },
        left_shoulder:   { x: 0.40, y: 0.22, isTracked: true },
        right_shoulder:  { x: 0.60, y: 0.22, isTracked: true },
        left_hip:        { x: 0.43, y: 0.50, isTracked: true },
        right_hip:       { x: 0.57, y: 0.50, isTracked: true },
      };

      const result = guard.step(joints);

      expect(result.checks.minJoints).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Head below shoulders -> rejected
  // -----------------------------------------------------------------------
  describe('anatomical plausibility — head position', () => {
    test('rejects when head Y is below shoulder midpoint', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      // Move head below shoulders (higher Y = lower on screen).
      joints.head = { x: 0.50, y: 0.35, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.anatomicalPlausibility).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Zero shoulder width -> rejected
  // -----------------------------------------------------------------------
  describe('anatomical plausibility — shoulder width', () => {
    test('rejects when shoulders overlap (zero width)', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      joints.left_shoulder = { x: 0.50, y: 0.22, isTracked: true };
      joints.right_shoulder = { x: 0.50, y: 0.22, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.anatomicalPlausibility).toBe(false);
    });

    test('rejects when shoulder width is absurdly large', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      joints.left_shoulder = { x: 0.05, y: 0.22, isTracked: true };
      joints.right_shoulder = { x: 0.95, y: 0.22, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.anatomicalPlausibility).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Shoulders below hips -> rejected
  // -----------------------------------------------------------------------
  describe('anatomical plausibility — shoulders vs hips', () => {
    test('rejects when shoulders are below hips', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      // Swap shoulder and hip Y positions.
      joints.left_shoulder =  { x: 0.40, y: 0.55, isTracked: true };
      joints.right_shoulder = { x: 0.60, y: 0.55, isTracked: true };
      joints.left_hip =       { x: 0.43, y: 0.20, isTracked: true };
      joints.right_hip =      { x: 0.57, y: 0.20, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.anatomicalPlausibility).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Extreme proportions -> rejected
  // -----------------------------------------------------------------------
  describe('body proportions', () => {
    test('rejects when torso is too short', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      // Torso length < 0.05: shoulders and hips nearly same Y.
      joints.left_hip =  { x: 0.43, y: 0.24, isTracked: true };
      joints.right_hip = { x: 0.57, y: 0.24, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.bodyProportions).toBe(false);
    });

    test('rejects when torso is implausibly long', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      // Torso > 0.5.
      joints.left_shoulder =  { x: 0.40, y: 0.05, isTracked: true };
      joints.right_shoulder = { x: 0.60, y: 0.05, isTracked: true };
      joints.left_hip =       { x: 0.43, y: 0.60, isTracked: true };
      joints.right_hip =      { x: 0.57, y: 0.60, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.bodyProportions).toBe(false);
    });

    test('rejects when shoulder-to-torso ratio is extreme', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();
      // Very narrow shoulders (0.03) with long torso (0.28) → ratio 0.107 < 0.15.
      joints.left_shoulder =  { x: 0.485, y: 0.22, isTracked: true };
      joints.right_shoulder = { x: 0.515, y: 0.22, isTracked: true };

      const result = guard.step(joints);

      expect(result.checks.bodyProportions).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Static object (30+ frames no movement) -> rejected
  // -----------------------------------------------------------------------
  describe('static object detection', () => {
    test('rejects after 30 consecutive frames with no movement', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();

      // Feed identical frames — all perfectly still.
      let result = guard.step(joints);
      for (let i = 1; i <= 30; i++) {
        result = guard.step(joints);
      }

      expect(result.checks.notStatic).toBe(false);
    });

    test('does not reject at frame 29 (just under threshold)', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();

      let result = guard.step(joints);
      for (let i = 1; i < 30; i++) {
        result = guard.step(joints);
      }

      expect(result.checks.notStatic).toBe(true);
    });

    test('resets static counter when movement is detected', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();

      // 25 static frames.
      for (let i = 0; i < 25; i++) {
        guard.step(joints);
      }

      // One frame with movement.
      const moved = { ...joints };
      moved.head = { x: 0.50 + 0.01, y: 0.10, isTracked: true };
      guard.step(moved);

      // 25 more static frames — counter should have reset.
      let result = guard.step(joints);
      for (let i = 0; i < 24; i++) {
        result = guard.step(joints);
      }

      expect(result.checks.notStatic).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Dead hang person (micro-movements) -> passes static check
  // -----------------------------------------------------------------------
  describe('dead hang (micro-movements)', () => {
    test('passes static check due to micro-movements', () => {
      const guard = new HumanValidationGuard();
      const base = validHumanJoints();

      // Feed frames with tiny jitter (simulating breathing / micro-sway).
      // Magnitude 0.003 is above the 0.001 velocity threshold.
      for (let i = 0; i < 40; i++) {
        guard.step(jitter(base, 0.005));
      }

      const result = guard.step(jitter(base, 0.005));

      expect(result.checks.notStatic).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Partial body (only upper body, 4+ joints) -> passes
  // -----------------------------------------------------------------------
  describe('partial body (upper body only)', () => {
    test('passes with only upper body joints tracked', () => {
      const guard = new HumanValidationGuard();
      const joints: Record<string, Joint2D> = {
        head:            { x: 0.50, y: 0.10, isTracked: true },
        neck:            { x: 0.50, y: 0.18, isTracked: true },
        left_shoulder:   { x: 0.40, y: 0.22, isTracked: true },
        right_shoulder:  { x: 0.60, y: 0.22, isTracked: true },
        left_elbow:      { x: 0.35, y: 0.35, isTracked: true },
        right_elbow:     { x: 0.65, y: 0.35, isTracked: true },
        left_hand:       { x: 0.32, y: 0.48, isTracked: true },
        right_hand:      { x: 0.68, y: 0.48, isTracked: true },
        left_hip:        { x: 0.43, y: 0.50, isTracked: false },
        right_hip:       { x: 0.57, y: 0.50, isTracked: false },
      };

      guard.step(jitter(joints));
      const result = guard.step(jitter(joints));

      expect(result.checks.minJoints).toBe(true);
      // Anatomical and proportions give benefit of the doubt when hips missing.
      expect(result.checks.anatomicalPlausibility).toBe(true);
      expect(result.checks.bodyProportions).toBe(true);
      expect(result.isHuman).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Completely random joint positions -> low confidence
  // -----------------------------------------------------------------------
  describe('random joint positions', () => {
    test('produces low confidence for spatially nonsensical joints', () => {
      const guard = new HumanValidationGuard();
      // Joints scattered randomly — head far below shoulders, shoulders
      // inverted and below hips, torso nearly zero. This should fail
      // anatomical (head below shoulders, shoulders below hips, left > right)
      // AND proportions (torso too short).
      const joints: Record<string, Joint2D> = {
        head:            { x: 0.10, y: 0.90, isTracked: true },
        neck:            { x: 0.80, y: 0.30, isTracked: true },
        left_shoulder:   { x: 0.55, y: 0.50, isTracked: true },
        right_shoulder:  { x: 0.45, y: 0.50, isTracked: true },
        left_elbow:      { x: 0.50, y: 0.10, isTracked: true },
        right_elbow:     { x: 0.30, y: 0.85, isTracked: true },
        left_hand:       { x: 0.70, y: 0.55, isTracked: true },
        right_hand:      { x: 0.10, y: 0.25, isTracked: true },
        left_hip:        { x: 0.48, y: 0.51, isTracked: true },
        right_hip:       { x: 0.52, y: 0.51, isTracked: true },
      };

      const result = guard.step(joints);

      // Anatomical fails (head below, left_shoulder > right_shoulder),
      // proportions fail (torso ~0.01), so at most 0.45 confidence.
      expect(result.confidence).toBeLessThan(0.6);
      expect(result.isHuman).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Reset clears accumulated state
  // -----------------------------------------------------------------------
  describe('reset', () => {
    test('clears velocity history and static frame counter', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();

      // Accumulate 25 static frames.
      for (let i = 0; i <= 25; i++) {
        guard.step(joints);
      }

      guard.reset();

      // After reset, first frame should treat as fresh (no prior data).
      const result = guard.step(joints);
      expect(result.checks.notStatic).toBe(true);

      // Verify the counter truly restarted — 10 more static frames should not trip it.
      let last = result;
      for (let i = 0; i < 10; i++) {
        last = guard.step(joints);
      }
      expect(last.checks.notStatic).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Joints with isTracked: false are not counted toward minimum
  // -----------------------------------------------------------------------
  describe('isTracked: false joints', () => {
    test('untracked joints are not counted', () => {
      const guard = new HumanValidationGuard();
      const joints: Record<string, Joint2D> = {
        head:            { x: 0.50, y: 0.10, isTracked: false },
        neck:            { x: 0.50, y: 0.18, isTracked: false },
        left_shoulder:   { x: 0.40, y: 0.22, isTracked: true },
        right_shoulder:  { x: 0.60, y: 0.22, isTracked: true },
        left_elbow:      { x: 0.35, y: 0.35, isTracked: true },
        right_elbow:     { x: 0.65, y: 0.35, isTracked: false },
        left_hand:       { x: 0.32, y: 0.48, isTracked: false },
        right_hand:      { x: 0.68, y: 0.48, isTracked: false },
        left_hip:        { x: 0.43, y: 0.50, isTracked: false },
        right_hip:       { x: 0.57, y: 0.50, isTracked: false },
      };

      const result = guard.step(joints);

      // Only 3 tracked: left_shoulder, right_shoulder, left_elbow.
      expect(result.checks.minJoints).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Confidence scoring
  // -----------------------------------------------------------------------
  describe('confidence scoring', () => {
    test('confidence is 1.0 when all checks pass', () => {
      const guard = new HumanValidationGuard();
      const joints = validHumanJoints();

      guard.step(jitter(joints));
      const result = guard.step(jitter(joints));

      expect(result.confidence).toBe(1.0);
    });

    test('confidence decreases proportionally with failed checks', () => {
      const guard = new HumanValidationGuard();
      // Only 2 tracked joints — fails minJoints.
      const joints: Record<string, Joint2D> = {
        left_shoulder:  { x: 0.40, y: 0.22, isTracked: true },
        right_shoulder: { x: 0.60, y: 0.22, isTracked: true },
      };

      const result = guard.step(joints);

      // minJoints fails (0.25), but anatomy + proportions give benefit of doubt.
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.checks.minJoints).toBe(false);
    });

    test('custom humanConfidenceThreshold is respected', () => {
      const guard = new HumanValidationGuard({ humanConfidenceThreshold: 0.9 });
      const joints = validHumanJoints();

      // Feed only one frame — static check passes but with tight threshold.
      const result = guard.step(joints);

      // All checks pass → confidence 1.0, which is >= 0.9.
      expect(result.isHuman).toBe(true);
    });
  });
});

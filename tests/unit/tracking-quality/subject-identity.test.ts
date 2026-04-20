import {
  SubjectIdentityTracker,
  type SubjectIdentitySnapshot,
} from '@/lib/tracking-quality/subject-identity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Joint = { x: number; y: number; isTracked: boolean; confidence?: number };

/** Build a full set of joints that form a plausible body. */
function makeBody(overrides?: Partial<Record<string, Partial<Joint>>>): Record<string, Joint> {
  const base: Record<string, Joint> = {
    head: { x: 0.5, y: 0.1, isTracked: true },
    neck: { x: 0.5, y: 0.15, isTracked: true },
    left_shoulder: { x: 0.4, y: 0.2, isTracked: true },
    right_shoulder: { x: 0.6, y: 0.2, isTracked: true },
    left_hand: { x: 0.35, y: 0.5, isTracked: true },
    right_hand: { x: 0.65, y: 0.5, isTracked: true },
    left_hip: { x: 0.45, y: 0.55, isTracked: true },
    right_hip: { x: 0.55, y: 0.55, isTracked: true },
  };

  if (overrides) {
    for (const [key, patch] of Object.entries(overrides)) {
      if (base[key]) {
        base[key] = { ...base[key], ...patch };
      } else {
        base[key] = { x: 0, y: 0, isTracked: true, ...patch } as Joint;
      }
    }
  }

  return base;
}

/** Build a body with different proportions to simulate a different person. */
function makeDifferentBody(): Record<string, Joint> {
  return makeBody({
    // Much wider shoulders
    left_shoulder: { x: 0.25, y: 0.2 },
    right_shoulder: { x: 0.75, y: 0.2 },
    // Shorter torso
    left_hip: { x: 0.35, y: 0.35 },
    right_hip: { x: 0.65, y: 0.35 },
    // Different arm reach
    left_hand: { x: 0.15, y: 0.55 },
    right_hand: { x: 0.85, y: 0.55 },
  });
}

/** Feed N identical frames and return the last snapshot. */
function feedFrames(
  tracker: SubjectIdentityTracker,
  joints: Record<string, Joint>,
  count: number,
): SubjectIdentitySnapshot {
  let snap!: SubjectIdentitySnapshot;
  for (let i = 0; i < count; i++) {
    snap = tracker.step(joints);
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubjectIdentityTracker', () => {
  // -----------------------------------------------------------------------
  // Calibration
  // -----------------------------------------------------------------------

  describe('calibration', () => {
    test('not calibrated before N frames', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 20 });
      const body = makeBody();

      for (let i = 0; i < 19; i++) {
        const snap = tracker.step(body);
        expect(snap.isCalibrated).toBe(false);
        expect(snap.isOriginalSubject).toBe(true); // always true during cal
      }
    });

    test('calibrated after N frames with stable joints', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 10 });
      const body = makeBody();

      const snap = feedFrames(tracker, body, 10);

      expect(snap.isCalibrated).toBe(true);
      expect(snap.isOriginalSubject).toBe(true);
      expect(snap.signature).not.toBeNull();
    });

    test('calibration builds correct signature (shoulder width, torso length, arm ratio)', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 5,
        signatureAlpha: 1.0, // Use alpha=1 so signature = last raw value exactly
      });

      const body = makeBody({
        left_shoulder: { x: 0.3, y: 0.2 },
        right_shoulder: { x: 0.7, y: 0.2 },
        left_hip: { x: 0.4, y: 0.6 },
        right_hip: { x: 0.6, y: 0.6 },
        left_hand: { x: 0.1, y: 0.5 },
        right_hand: { x: 0.9, y: 0.5 },
      });

      const snap = feedFrames(tracker, body, 5);

      expect(snap.signature).not.toBeNull();
      const sig = snap.signature!;

      // shoulder width = dist((0.3,0.2), (0.7,0.2)) = 0.4
      expect(sig.shoulderWidth).toBeCloseTo(0.4, 4);

      // torso length = |avg(0.2, 0.2) - avg(0.6, 0.6)| = 0.4
      expect(sig.torsoLength).toBeCloseTo(0.4, 4);

      // arm ratio: average of left and right (shoulder-to-hand / torso)
      // left: dist((0.3,0.2),(0.1,0.5)) / 0.4
      const leftArm = Math.sqrt(0.04 + 0.09); // ~0.3606
      // right: dist((0.7,0.2),(0.9,0.5)) / 0.4
      const rightArm = Math.sqrt(0.04 + 0.09); // ~0.3606
      const expectedArmRatio = ((leftArm / 0.4) + (rightArm / 0.4)) / 2;
      expect(sig.armRatio).toBeCloseTo(expectedArmRatio, 3);
    });
  });

  // -----------------------------------------------------------------------
  // Centroid jump
  // -----------------------------------------------------------------------

  describe('centroid jump', () => {
    test('normal movement (small delta) produces no significant jump', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 5 });
      const body1 = makeBody();

      feedFrames(tracker, body1, 5);

      // Slight shift (simulating small body movement)
      const body2 = makeBody({
        head: { x: 0.51, y: 0.1 },
        neck: { x: 0.51, y: 0.15 },
        left_shoulder: { x: 0.41, y: 0.2 },
        right_shoulder: { x: 0.61, y: 0.2 },
        left_hip: { x: 0.46, y: 0.55 },
        right_hip: { x: 0.56, y: 0.55 },
      });

      const snap = tracker.step(body2);
      expect(snap.centroidJump).toBeLessThan(0.15);
    });

    test('large position jump (>0.15) is detected', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 5 });
      const body1 = makeBody();

      feedFrames(tracker, body1, 5);

      // Teleport the whole body to the right side of the screen
      const body2 = makeBody({
        head: { x: 0.8, y: 0.1 },
        neck: { x: 0.8, y: 0.15 },
        left_shoulder: { x: 0.7, y: 0.2 },
        right_shoulder: { x: 0.9, y: 0.2 },
        left_hand: { x: 0.65, y: 0.5 },
        right_hand: { x: 0.95, y: 0.5 },
        left_hip: { x: 0.75, y: 0.55 },
        right_hip: { x: 0.85, y: 0.55 },
      });

      const snap = tracker.step(body2);
      expect(snap.centroidJump).toBeGreaterThan(0.15);
    });

    test('gradual movement (walk across screen) produces no jump', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 5 });
      const body = makeBody();

      feedFrames(tracker, body, 5);

      // Move 0.005 per frame over many frames (smooth walk)
      let xOffset = 0;
      for (let i = 0; i < 40; i++) {
        xOffset += 0.005;
        const shifted = makeBody({
          head: { x: 0.5 + xOffset, y: 0.1 },
          neck: { x: 0.5 + xOffset, y: 0.15 },
          left_shoulder: { x: 0.4 + xOffset, y: 0.2 },
          right_shoulder: { x: 0.6 + xOffset, y: 0.2 },
          left_hand: { x: 0.35 + xOffset, y: 0.5 },
          right_hand: { x: 0.65 + xOffset, y: 0.5 },
          left_hip: { x: 0.45 + xOffset, y: 0.55 },
          right_hip: { x: 0.55 + xOffset, y: 0.55 },
        });

        const snap = tracker.step(shifted);
        expect(snap.centroidJump).toBeLessThan(0.15);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Subject switch
  // -----------------------------------------------------------------------

  describe('subject switch', () => {
    test('same person (stable signature) stays as original subject', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 10 });
      const body = makeBody();

      // Calibrate then feed 30 more frames of the same body
      feedFrames(tracker, body, 10);
      const snap = feedFrames(tracker, body, 30);

      expect(snap.isCalibrated).toBe(true);
      expect(snap.isOriginalSubject).toBe(true);
      expect(snap.switchDetected).toBe(false);
    });

    test('different proportions trigger switch after N consecutive frames', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 5,
        signatureAlpha: 0.5, // Higher alpha so current sig tracks new person faster
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      const different = makeDifferentBody();
      const snap = feedFrames(tracker, different, 30);

      expect(snap.isCalibrated).toBe(true);
      expect(snap.switchDetected).toBe(true);
      expect(snap.isOriginalSubject).toBe(false);
    });

    test('single-frame anomaly does NOT flag as switch', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 5,
        signatureAlpha: 1.0, // Instant tracking for test clarity
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      // One frame of a different person
      const different = makeDifferentBody();
      tracker.step(different);

      // Immediately back to original
      const snap = feedFrames(tracker, body, 2);

      expect(snap.switchDetected).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Recovery
  // -----------------------------------------------------------------------

  describe('recovery', () => {
    test('after switch, original signature returns and recovers', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 3,
        consecRecoveryFrames: 5,
        signatureAlpha: 0.8,
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      // Switch to a different person
      const different = makeDifferentBody();
      feedFrames(tracker, different, 20);

      // Confirm switch happened
      let snap = tracker.getSnapshot();
      expect(snap.switchDetected).toBe(true);

      // Original person returns — feed enough frames for EMA to converge
      // and then enough recovery frames
      snap = feedFrames(tracker, body, 60);

      expect(snap.switchDetected).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
    });

    test('new person stays means switch persists until auto-recalibrate', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 3,
        signatureAlpha: 0.5,
        autoRecalibrateFrames: 150, // 5s at 30fps
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      const different = makeDifferentBody();

      // Feed 50 frames — switch detected but not yet auto-recalibrated
      const midSnap = feedFrames(tracker, different, 50);
      expect(midSnap.switchDetected).toBe(true);
      expect(midSnap.isOriginalSubject).toBe(false);
      expect(midSnap.recalibrated).toBe(false);

      // Feed enough to hit autoRecalibrateFrames — should auto-accept
      const afterSnap = feedFrames(tracker, different, 150);
      expect(afterSnap.switchDetected).toBe(false);
      expect(afterSnap.isOriginalSubject).toBe(true);
      expect(afterSnap.recalibrated).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Auto-recalibrate & manual recalibrate
  // -----------------------------------------------------------------------

  describe('recalibrate', () => {
    test('manual recalibrate() accepts the new subject immediately', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 3,
        signatureAlpha: 0.5,
        autoRecalibrateFrames: 0, // disable auto
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      const different = makeDifferentBody();
      feedFrames(tracker, different, 20);

      expect(tracker.getSnapshot().switchDetected).toBe(true);

      tracker.recalibrate();
      const snap = tracker.getSnapshot();

      expect(snap.switchDetected).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
      expect(snap.recalibrated).toBe(true);
      expect(snap.signatureDeviation).toBe(0);
    });

    test('after recalibrate, new person is treated as baseline', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 3,
        signatureAlpha: 0.5,
        autoRecalibrateFrames: 0,
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      const different = makeDifferentBody();
      feedFrames(tracker, different, 20);
      tracker.recalibrate();

      // Continue with the "different" person — should be stable
      const snap = feedFrames(tracker, different, 30);
      expect(snap.switchDetected).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
    });

    test('auto-recalibrate disabled (0) means switch persists forever', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 10,
        consecSwitchFrames: 3,
        signatureAlpha: 0.5,
        autoRecalibrateFrames: 0,
      });

      const body = makeBody();
      feedFrames(tracker, body, 10);

      const different = makeDifferentBody();
      const snap = feedFrames(tracker, different, 300);

      expect(snap.switchDetected).toBe(true);
      expect(snap.recalibrated).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    test('too few tracked joints skips comparison and does not false-flag', () => {
      const tracker = new SubjectIdentityTracker({
        calibrationFrames: 5,
        consecSwitchFrames: 3,
      });

      const body = makeBody();
      feedFrames(tracker, body, 5);

      // Frame with only 2 tracked joints (below minimum of 3 for centroid)
      const sparse: Record<string, Joint> = {
        head: { x: 0.9, y: 0.9, isTracked: true },
        neck: { x: 0.9, y: 0.85, isTracked: true },
        left_shoulder: { x: 0, y: 0, isTracked: false },
        right_shoulder: { x: 0, y: 0, isTracked: false },
        left_hand: { x: 0, y: 0, isTracked: false },
        right_hand: { x: 0, y: 0, isTracked: false },
        left_hip: { x: 0, y: 0, isTracked: false },
        right_hip: { x: 0, y: 0, isTracked: false },
      };

      const snap = tracker.step(sparse);

      // Should not falsely trigger a switch due to missing signature joints
      expect(snap.switchDetected).toBe(false);
      // Centroid jump should be 0 since we don't have enough joints
      expect(snap.centroidJump).toBe(0);
    });

    test('reset clears calibration and state', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 5 });
      const body = makeBody();

      feedFrames(tracker, body, 10);
      expect(tracker.getSnapshot().isCalibrated).toBe(true);

      tracker.reset();
      const snap = tracker.getSnapshot();

      expect(snap.isCalibrated).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
      expect(snap.switchDetected).toBe(false);
      expect(snap.centroidJump).toBe(0);
      expect(snap.signatureDeviation).toBe(0);
      expect(snap.framesSinceSwitchDetected).toBe(0);
      expect(snap.signature).toBeNull();
    });

    test('all joints untracked causes no crash and graceful handling', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 5 });

      const allUntracked: Record<string, Joint> = {
        head: { x: 0, y: 0, isTracked: false },
        neck: { x: 0, y: 0, isTracked: false },
        left_shoulder: { x: 0, y: 0, isTracked: false },
        right_shoulder: { x: 0, y: 0, isTracked: false },
        left_hand: { x: 0, y: 0, isTracked: false },
        right_hand: { x: 0, y: 0, isTracked: false },
        left_hip: { x: 0, y: 0, isTracked: false },
        right_hip: { x: 0, y: 0, isTracked: false },
      };

      // Should not throw
      const snap = tracker.step(allUntracked);

      expect(snap.isCalibrated).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
      expect(snap.centroidJump).toBe(0);
      expect(snap.signatureDeviation).toBe(0);
    });

    test('empty joints object causes no crash', () => {
      const tracker = new SubjectIdentityTracker({ calibrationFrames: 5 });

      const snap = tracker.step({});

      expect(snap.isCalibrated).toBe(false);
      expect(snap.isOriginalSubject).toBe(true);
      expect(snap.centroidJump).toBe(0);
    });
  });
});

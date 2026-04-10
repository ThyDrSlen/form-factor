import { VerticalDisplacementTracker, type VerticalSignal } from '@/lib/tracking-quality/vertical-displacement';

type JointInput = Record<string, { x: number; y: number; isTracked: boolean }>;

/** Build a joints record with both shoulders at the given Y */
function makeShoulder(y: number): JointInput {
  return {
    left_shoulder: { x: 0.4, y, isTracked: true },
    right_shoulder: { x: 0.6, y, isTracked: true },
  };
}

/** Build joints with only one shoulder */
function makeOneShoulder(y: number, side: 'left' | 'right'): JointInput {
  return {
    [`${side}_shoulder`]: { x: 0.5, y, isTracked: true },
  };
}

/** Build joints with only head */
function makeHead(y: number): JointInput {
  return {
    head: { x: 0.5, y, isTracked: true },
  };
}

/** Build joints with only hips */
function makeHips(y: number): JointInput {
  return {
    left_hip: { x: 0.4, y, isTracked: true },
    right_hip: { x: 0.6, y, isTracked: true },
  };
}

/**
 * Generate sinusoidal Y data simulating pullup reps.
 *
 * For pullups: body starts at bottom (high Y ~0.7), goes up (low Y ~0.3), back down.
 * Y = center + amplitude * sin(2*PI*t/period)
 * At bottom: Y = center + amplitude = 0.7  (valley in body height = max Y)
 * At top:    Y = center - amplitude = 0.3  (peak in body height  = min Y)
 */
function generateSinusoidalYData(
  numReps: number,
  framesPerRep: number,
  center = 0.5,
  amplitude = 0.2,
): number[] {
  const total = numReps * framesPerRep;
  const ys: number[] = [];
  for (let i = 0; i < total; i++) {
    // sin starts at 0 (middle), goes to 1 (bottom), -1 (top)
    // We want to start at bottom, so shift phase
    const phase = (i / framesPerRep) * 2 * Math.PI - Math.PI / 2;
    ys.push(center + amplitude * Math.sin(phase));
  }
  return ys;
}

/** Collect all signals from a sequence of Y values */
function runTracker(
  ys: number[],
  jointBuilder: (y: number) => JointInput = makeShoulder,
  config?: Parameters<typeof VerticalDisplacementTracker['prototype']['processFrame']> extends [infer _] ? ConstructorParameters<typeof VerticalDisplacementTracker>[0] : never,
): VerticalSignal[] {
  const tracker = new VerticalDisplacementTracker(config);
  return ys.map((y) => tracker.processFrame(jointBuilder(y)));
}

describe('VerticalDisplacementTracker', () => {
  describe('EMA smoothing', () => {
    test('first frame sets smoothedY directly without smoothing', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeShoulder(0.6));
      expect(signal.smoothedY).toBeCloseTo(0.6, 5);
    });

    test('step response: EMA converges toward new value', () => {
      const tracker = new VerticalDisplacementTracker({ emaAlpha: 0.3 });
      // Start at 0.5, then jump to 0.3
      tracker.processFrame(makeShoulder(0.5));
      const s2 = tracker.processFrame(makeShoulder(0.3));
      // After 1 step: 0.5 + (0.3 - 0.5) * 0.3 = 0.44
      expect(s2.smoothedY).toBeCloseTo(0.44, 4);

      const s3 = tracker.processFrame(makeShoulder(0.3));
      // After 2 steps: 0.44 + (0.3 - 0.44) * 0.3 = 0.398
      expect(s3.smoothedY).toBeCloseTo(0.398, 3);
    });

    test('with alpha=1.0 there is no smoothing (instant response)', () => {
      const tracker = new VerticalDisplacementTracker({ emaAlpha: 1.0 });
      tracker.processFrame(makeShoulder(0.5));
      const signal = tracker.processFrame(makeShoulder(0.3));
      expect(signal.smoothedY).toBeCloseTo(0.3, 5);
    });

    test('noise rejection: small jitter does not produce large smoothedY changes', () => {
      const tracker = new VerticalDisplacementTracker({ emaAlpha: 0.3 });
      // Stable at 0.5 with tiny noise
      const noisy = [0.5, 0.502, 0.498, 0.501, 0.499, 0.503, 0.497];
      const signals = noisy.map((y) => tracker.processFrame(makeShoulder(y)));

      for (const s of signals) {
        expect(Math.abs(s.smoothedY - 0.5)).toBeLessThan(0.01);
      }
    });
  });

  describe('velocity', () => {
    test('velocity is 0 on first frame', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeShoulder(0.5));
      expect(signal.velocity).toBe(0);
    });

    test('velocity is negative when moving up (Y decreasing)', () => {
      const tracker = new VerticalDisplacementTracker({ emaAlpha: 1.0 });
      tracker.processFrame(makeShoulder(0.6));
      const signal = tracker.processFrame(makeShoulder(0.4));
      expect(signal.velocity).toBeLessThan(0);
    });

    test('velocity is positive when moving down (Y increasing)', () => {
      const tracker = new VerticalDisplacementTracker({ emaAlpha: 1.0 });
      tracker.processFrame(makeShoulder(0.4));
      const signal = tracker.processFrame(makeShoulder(0.6));
      expect(signal.velocity).toBeGreaterThan(0);
    });
  });

  describe('peak and valley detection with sinusoidal data', () => {
    test('detects peaks and valleys for 3 simulated pullup reps', () => {
      const framesPerRep = 40;
      const ys = generateSinusoidalYData(3, framesPerRep);

      // Use windowSize=3 for hysteresis
      const signals = runTracker(ys, makeShoulder, { windowSize: 3, emaAlpha: 0.5 });

      const peaks = signals.filter((s) => s.isPeak);
      const valleys = signals.filter((s) => s.isValley);

      // Should detect at least 2 peaks and 2 valleys over 3 reps
      // (first partial cycle may or may not produce a peak depending on init)
      expect(peaks.length).toBeGreaterThanOrEqual(2);
      expect(valleys.length).toBeGreaterThanOrEqual(2);
    });

    test('peak-to-valley delta reflects amplitude', () => {
      const framesPerRep = 60;
      const amplitude = 0.2;
      const ys = generateSinusoidalYData(3, framesPerRep, 0.5, amplitude);
      const signals = runTracker(ys, makeShoulder, { windowSize: 3, emaAlpha: 0.6 });

      // Find the last peak or valley event with a delta
      const withDelta = signals.filter((s) => s.peakToValleyDelta > 0);
      expect(withDelta.length).toBeGreaterThan(0);

      // The peak-to-valley delta should be in the ballpark of 2*amplitude (0.4)
      // EMA smoothing reduces it, so check it's at least half
      const lastDelta = withDelta[withDelta.length - 1].peakToValleyDelta;
      expect(lastDelta).toBeGreaterThan(amplitude * 0.5);
      expect(lastDelta).toBeLessThanOrEqual(2 * amplitude + 0.05);
    });

    test('peaks have lower Y than valleys (body higher on screen at peak)', () => {
      const ys = generateSinusoidalYData(3, 60, 0.5, 0.2);
      const signals = runTracker(ys, makeShoulder, { windowSize: 3, emaAlpha: 0.6 });

      const peakYs = signals.filter((s) => s.isPeak).map((s) => s.smoothedY);
      const valleyYs = signals.filter((s) => s.isValley).map((s) => s.smoothedY);

      if (peakYs.length > 0 && valleyYs.length > 0) {
        const avgPeakY = peakYs.reduce((a, b) => a + b, 0) / peakYs.length;
        const avgValleyY = valleyYs.reduce((a, b) => a + b, 0) / valleyYs.length;
        // Peak (body at top) should have lower Y than valley (body at bottom)
        expect(avgPeakY).toBeLessThan(avgValleyY);
      }
    });
  });

  describe('hysteresis', () => {
    test('single-frame noise spike does not trigger false peak', () => {
      const tracker = new VerticalDisplacementTracker({ windowSize: 3, emaAlpha: 1.0 });

      // Steady descent (body going down, Y increasing)
      const ys = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
      const signals: VerticalSignal[] = [];
      for (const y of ys) {
        signals.push(tracker.processFrame(makeShoulder(y)));
      }

      // Inject single noise frame going opposite direction
      signals.push(tracker.processFrame(makeShoulder(0.68)));
      // Continue descent
      signals.push(tracker.processFrame(makeShoulder(0.72)));
      signals.push(tracker.processFrame(makeShoulder(0.75)));

      // Single noise frame should not cause a peak
      const peaks = signals.filter((s) => s.isPeak);
      expect(peaks.length).toBe(0);
    });

    test('two-frame direction change with windowSize=3 does not trigger', () => {
      const tracker = new VerticalDisplacementTracker({ windowSize: 3, emaAlpha: 1.0 });

      // Go down
      for (let i = 0; i < 8; i++) {
        tracker.processFrame(makeShoulder(0.3 + i * 0.05));
      }

      // Two frames up (not enough for windowSize=3)
      tracker.processFrame(makeShoulder(0.62));
      const signal = tracker.processFrame(makeShoulder(0.58));

      expect(signal.isPeak).toBe(false);
      expect(signal.isValley).toBe(false);
    });
  });

  describe('joint fallback chain', () => {
    test('uses both shoulders when available (confidence=1.0)', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeShoulder(0.5));
      expect(signal.confidence).toBe(1.0);
      expect(signal.referenceJoint).toBe('shoulders_avg');
    });

    test('falls back to single shoulder (confidence=0.7)', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeOneShoulder(0.5, 'left'));
      expect(signal.confidence).toBe(0.7);
      expect(signal.referenceJoint).toBe('left_shoulder');
    });

    test('falls back to head (confidence=0.5)', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeHead(0.5));
      expect(signal.confidence).toBe(0.5);
      expect(signal.referenceJoint).toBe('head');
    });

    test('falls back to hips (confidence=0.3)', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeHips(0.5));
      expect(signal.confidence).toBe(0.3);
      expect(signal.referenceJoint).toBe('hips_avg');
    });

    test('returns zero confidence when no joints are tracked', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame({});
      expect(signal.confidence).toBe(0);
      expect(signal.referenceJoint).toBe('none');
    });

    test('skips untracked joints even if present', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame({
        left_shoulder: { x: 0.4, y: 0.5, isTracked: false },
        right_shoulder: { x: 0.6, y: 0.5, isTracked: false },
        head: { x: 0.5, y: 0.5, isTracked: true },
      });
      expect(signal.confidence).toBe(0.5);
      expect(signal.referenceJoint).toBe('head');
    });

    test('prefers shoulders over head even when all available', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame({
        left_shoulder: { x: 0.4, y: 0.5, isTracked: true },
        right_shoulder: { x: 0.6, y: 0.5, isTracked: true },
        head: { x: 0.5, y: 0.45, isTracked: true },
      });
      expect(signal.referenceJoint).toBe('shoulders_avg');
      expect(signal.confidence).toBe(1.0);
    });
  });

  describe('minPeakDelta threshold', () => {
    test('small oscillation below minPeakDelta does not trigger peaks', () => {
      const tracker = new VerticalDisplacementTracker({
        minPeakDelta: 0.08,
        emaAlpha: 1.0,
        windowSize: 3,
      });

      // Small oscillation: amplitude 0.02 which is well below 0.08
      const ys: number[] = [];
      for (let i = 0; i < 60; i++) {
        ys.push(0.5 + 0.02 * Math.sin((i / 10) * 2 * Math.PI));
      }

      const signals = ys.map((y) => tracker.processFrame(makeShoulder(y)));
      const peaks = signals.filter((s) => s.isPeak);
      const valleys = signals.filter((s) => s.isValley);

      expect(peaks.length).toBe(0);
      expect(valleys.length).toBe(0);
    });

    test('oscillation above minPeakDelta triggers peaks', () => {
      const tracker = new VerticalDisplacementTracker({
        minPeakDelta: 0.08,
        emaAlpha: 0.8,
        windowSize: 3,
      });

      // Large oscillation: amplitude 0.15 which is above 0.08
      const ys: number[] = [];
      for (let i = 0; i < 120; i++) {
        ys.push(0.5 + 0.15 * Math.sin((i / 30) * 2 * Math.PI));
      }

      const signals = ys.map((y) => tracker.processFrame(makeShoulder(y)));
      const peaks = signals.filter((s) => s.isPeak);
      expect(peaks.length).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    test('reset clears all internal state', () => {
      const tracker = new VerticalDisplacementTracker();

      // Build up some state
      const ys = generateSinusoidalYData(2, 30, 0.5, 0.2);
      for (const y of ys) {
        tracker.processFrame(makeShoulder(y));
      }

      tracker.reset();

      // After reset, first frame should behave like initial
      const signal = tracker.processFrame(makeShoulder(0.5));
      expect(signal.smoothedY).toBeCloseTo(0.5, 5);
      expect(signal.velocity).toBe(0);
      expect(signal.isPeak).toBe(false);
      expect(signal.isValley).toBe(false);
      expect(signal.peakToValleyDelta).toBe(0);
    });

    test('reset allows independent tracking sessions', () => {
      const tracker = new VerticalDisplacementTracker({ emaAlpha: 1.0 });

      // First session at Y=0.3
      tracker.processFrame(makeShoulder(0.3));
      tracker.processFrame(makeShoulder(0.3));

      tracker.reset();

      // Second session at Y=0.7 - should not be influenced by first
      const signal = tracker.processFrame(makeShoulder(0.7));
      expect(signal.smoothedY).toBeCloseTo(0.7, 5);
      expect(signal.velocity).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('handles NaN Y values by skipping joint pair but using valid individual', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame({
        left_shoulder: { x: 0.4, y: NaN, isTracked: true },
        right_shoulder: { x: 0.6, y: 0.5, isTracked: true },
        head: { x: 0.5, y: 0.5, isTracked: true },
      });
      // Both shoulders can't be averaged (left has NaN), but right_shoulder alone is valid
      expect(signal.referenceJoint).toBe('right_shoulder');
      expect(signal.confidence).toBe(0.7);
    });

    test('falls back to head when both shoulders have NaN Y', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame({
        left_shoulder: { x: 0.4, y: NaN, isTracked: true },
        right_shoulder: { x: 0.6, y: NaN, isTracked: true },
        head: { x: 0.5, y: 0.5, isTracked: true },
      });
      expect(signal.referenceJoint).toBe('head');
      expect(signal.confidence).toBe(0.5);
    });

    test('handles single frame input without crashing', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame(makeShoulder(0.5));
      expect(signal).toBeDefined();
      expect(signal.isPeak).toBe(false);
      expect(signal.isValley).toBe(false);
    });

    test('handles empty joints object', () => {
      const tracker = new VerticalDisplacementTracker();
      const signal = tracker.processFrame({});
      expect(signal.confidence).toBe(0);
      expect(signal.smoothedY).toBe(0);
    });
  });
});

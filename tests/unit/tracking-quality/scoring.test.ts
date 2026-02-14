import type { CanonicalJoint2D } from '@/lib/pose/types';
import { scorePullupWithComponentAvailability } from '@/lib/tracking-quality/scoring';

function joint(input: Partial<CanonicalJoint2D> & Pick<CanonicalJoint2D, 'x' | 'y' | 'isTracked'>): CanonicalJoint2D {
  return {
    x: input.x,
    y: input.y,
    isTracked: input.isTracked,
    confidence: input.confidence,
  };
}

function baseAngles() {
  return {
    start: { leftElbow: 165, rightElbow: 165, leftShoulder: 95, rightShoulder: 95 },
    end: { leftElbow: 90, rightElbow: 90, leftShoulder: 105, rightShoulder: 105 },
    min: { leftElbow: 80, rightElbow: 90, leftShoulder: 85, rightShoulder: 85 },
    max: { leftElbow: 170, rightElbow: 170, leftShoulder: 125, rightShoulder: 125 },
  };
}

describe('pull-up tracking-quality component scoring', () => {
  test('partial visibility omits affected components (right arm below weak threshold)', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.95 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.95 }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.9 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.2 }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 1100,
      joints,
    });

    expect(result.missing_components).toContain('symmetry_score');
    expect(result.visibility_badge).toBe('partial');
    expect(result.components.torso_stability_score).not.toBeNull();
  });

  test('single weak component does not report a confident overall score', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.31 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.31 }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: false, confidence: 0.99 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: false, confidence: 0.99 }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 1100,
      joints,
    });

    expect(result.components.torso_stability_score).not.toBeNull();
    expect(result.missing_components).toEqual(
      expect.arrayContaining(['rom_score', 'symmetry_score', 'tempo_score'])
    );
    expect(result.score_suppressed).toBe(true);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score as number).toBeLessThanOrEqual(result.components.torso_stability_score as number);
  });

  test('full visibility computes all components and marks full badge', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.9 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.9 }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.9 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.9 }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 1100,
      joints,
    });

    expect(result.visibility_badge).toBe('full');
    expect(result.missing_components).toEqual([]);
    expect(result.components.rom_score).not.toBeNull();
    expect(result.components.symmetry_score).not.toBeNull();
    expect(result.components.tempo_score).not.toBeNull();
    expect(result.components.torso_stability_score).not.toBeNull();
    expect(result.score_suppressed).toBe(false);
    expect(result.overall_score).not.toBeNull();
  });
});

import { calculateFqi } from '@/lib/services/fqi-calculator';
import type { WorkoutDefinition } from '@/lib/types/workout-definitions';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

const angles: JointAngles = {
  leftElbow: 170,
  rightElbow: 170,
  leftShoulder: 90,
  rightShoulder: 90,
  leftKnee: 170,
  rightKnee: 170,
  leftHip: 170,
  rightHip: 170,
};

const minAngles: JointAngles = {
  leftElbow: 160,
  rightElbow: 160,
  leftShoulder: 90,
  rightShoulder: 90,
  leftKnee: 170,
  rightKnee: 170,
  leftHip: 170,
  rightHip: 170,
};

const maxAngles: JointAngles = {
  leftElbow: 175,
  rightElbow: 175,
  leftShoulder: 90,
  rightShoulder: 90,
  leftKnee: 170,
  rightKnee: 170,
  leftHip: 170,
  rightHip: 170,
};

const def: WorkoutDefinition = {
  id: 'test',
  displayName: 'Test',
  description: '',
  category: 'upper_body',
  difficulty: 'beginner',
  phases: [],
  initialPhase: 'idle',
  repBoundary: { startPhase: 'idle', endPhase: 'idle', minDurationMs: 0 },
  thresholds: {},
  angleRanges: { elbow: { min: 160, max: 175, optimal: 170, tolerance: 5 } },
  faults: [],
  fqiWeights: { rom: 1, depth: 0, faults: 0 },
  calculateMetrics: () => ({ armsTracked: true }),
  getNextPhase: (phase) => phase,
  scoringMetrics: [
    {
      id: 'elbow',
      extract: (rep, side) => {
        if (side === 'left') {
          return {
            start: rep.start.leftElbow,
            end: rep.end.leftElbow,
            min: rep.min.leftElbow,
            max: rep.max.leftElbow,
          };
        }
        return {
          start: rep.start.rightElbow,
          end: rep.end.rightElbow,
          min: rep.min.rightElbow,
          max: rep.max.rightElbow,
        };
      },
    },
  ],
};

test('FQI uses scoringMetrics extractors', () => {
  const result = calculateFqi({ start: angles, end: angles, min: minAngles, max: maxAngles }, 1000, 1, def);
  expect(result.romScore).toBe(100);
});

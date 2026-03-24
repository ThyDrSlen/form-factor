import { workoutsByMode } from '@/lib/workouts';
import { pullupDefinition, PULLUP_THRESHOLDS } from '@/lib/workouts/pullup';
import { squatDefinition, SQUAT_THRESHOLDS } from '@/lib/workouts/squat';
import type { PullUpMetrics } from '@/lib/workouts/pullup';
import type { SquatMetrics } from '@/lib/workouts/squat';
import type { WorkoutMetrics } from '@/lib/types/workout-definitions';

const allWorkouts = Object.entries(workoutsByMode);

function makePullUpMetrics(overrides: Partial<PullUpMetrics> = {}): PullUpMetrics {
  return {
    avgElbow: 160,
    avgShoulder: 90,
    armsTracked: true,
    ...overrides,
  };
}

function makeSquatMetrics(overrides: Partial<SquatMetrics> = {}): SquatMetrics {
  return {
    avgKnee: 160,
    avgHip: 170,
    armsTracked: false,
    legsTracked: true,
    ...overrides,
  };
}

describe('dynamicCues', () => {
  test.each(allWorkouts)(
    '%s: every fault has a non-empty dynamicCue',
    (_mode, definition) => {
      expect(definition.faults.length).toBeGreaterThan(0);
      for (const fault of definition.faults) {
        expect(fault.dynamicCue).toBeTruthy();
        expect(typeof fault.dynamicCue).toBe('string');
        expect(fault.dynamicCue.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(allWorkouts)(
    '%s: dynamicCue strings are unique within the workout',
    (_mode, definition) => {
      const cues = definition.faults.map((f) => f.dynamicCue);
      expect(new Set(cues).size).toBe(cues.length);
    },
  );

  test.each(allWorkouts)(
    '%s: fault ids are unique within the workout',
    (_mode, definition) => {
      const ids = definition.faults.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

describe('realtimeCues', () => {
  describe('pullup', () => {
    const getRealtimeCues = pullupDefinition.ui!.getRealtimeCues!;

    test('hang phase: warns when elbows are not fully extended', () => {
      const cues = getRealtimeCues({
        phaseId: 'hang',
        metrics: makePullUpMetrics({ avgElbow: PULLUP_THRESHOLDS.hang - 10 }),
      });
      expect(cues).toContain('Fully extend your arms before the next rep.');
    });

    test('top phase: warns when not pulled high enough', () => {
      const cues = getRealtimeCues({
        phaseId: 'top',
        metrics: makePullUpMetrics({ avgElbow: PULLUP_THRESHOLDS.top + 20 }),
      });
      expect(cues).toContain('Pull higher to bring your chin past the bar.');
    });

    test('any phase: warns when shoulders are elevated', () => {
      const cues = getRealtimeCues({
        phaseId: 'pull',
        metrics: makePullUpMetrics({
          avgShoulder: PULLUP_THRESHOLDS.shoulderElevation + 5,
        }),
      });
      expect(cues).toContain('Draw your shoulders down to keep your lats engaged.');
    });

    test('idle phase with good form: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'idle',
        metrics: makePullUpMetrics(),
      });
      expect(cues).toEqual(['Strong reps — keep the descent smooth.']);
    });

    test('pull phase with good form: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'pull',
        metrics: makePullUpMetrics(),
      });
      expect(cues).toEqual(['Strong reps — keep the descent smooth.']);
    });

    test('hang phase with full extension: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'hang',
        metrics: makePullUpMetrics({ avgElbow: PULLUP_THRESHOLDS.hang + 5 }),
      });
      expect(cues).toEqual(['Strong reps — keep the descent smooth.']);
    });

    test('top phase with chin over bar: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'top',
        metrics: makePullUpMetrics({ avgElbow: PULLUP_THRESHOLDS.top }),
      });
      expect(cues).toEqual(['Strong reps — keep the descent smooth.']);
    });
  });

  // ---------------------------------------------------------------------------
  // Squat
  // ---------------------------------------------------------------------------
  describe('squat', () => {
    const getRealtimeCues = squatDefinition.ui!.getRealtimeCues!;

    test('standing phase: warns when not fully standing', () => {
      const cues = getRealtimeCues({
        phaseId: 'standing',
        metrics: makeSquatMetrics({ avgKnee: SQUAT_THRESHOLDS.standing - 15 }),
      });
      expect(cues).toContain('Stand all the way up between reps.');
    });

    test('bottom phase: warns when depth is insufficient', () => {
      const cues = getRealtimeCues({
        phaseId: 'bottom',
        metrics: makeSquatMetrics({ avgKnee: SQUAT_THRESHOLDS.parallel + 20 }),
      });
      expect(cues).toContain('Squat deeper — aim for hip crease below knees.');
    });

    test('setup phase with good form: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'setup',
        metrics: makeSquatMetrics(),
      });
      expect(cues).toEqual(['Controlled tempo — own every inch of the movement.']);
    });

    test('descent phase with good form: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'descent',
        metrics: makeSquatMetrics(),
      });
      expect(cues).toEqual(['Controlled tempo — own every inch of the movement.']);
    });

    test('ascent phase with good form: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'ascent',
        metrics: makeSquatMetrics(),
      });
      expect(cues).toEqual(['Controlled tempo — own every inch of the movement.']);
    });

    test('standing phase with full lockout: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'standing',
        metrics: makeSquatMetrics({ avgKnee: SQUAT_THRESHOLDS.standing + 5 }),
      });
      expect(cues).toEqual(['Controlled tempo — own every inch of the movement.']);
    });

    test('bottom phase with good depth: returns positive reinforcement', () => {
      const cues = getRealtimeCues({
        phaseId: 'bottom',
        metrics: makeSquatMetrics({ avgKnee: SQUAT_THRESHOLDS.parallel }),
      });
      expect(cues).toEqual(['Controlled tempo — own every inch of the movement.']);
    });
  });

  // ---------------------------------------------------------------------------
  // Fallback positive message (no faults → encouraging message)
  // ---------------------------------------------------------------------------
  describe('fallback positive message', () => {
    const workoutsWithRealtimeCues = allWorkouts.filter(
      ([, def]) => def.ui?.getRealtimeCues,
    );

    test.each(workoutsWithRealtimeCues)(
      '%s: returns a non-empty positive fallback when no faults triggered',
      (_mode, definition) => {
        const getRealtimeCues = definition.ui!.getRealtimeCues!;

        const neutralMetrics = definition.calculateMetrics({
          leftElbow: 160,
          rightElbow: 160,
          leftShoulder: 90,
          rightShoulder: 90,
          leftHip: 170,
          rightHip: 170,
          leftKnee: 165,
          rightKnee: 165,
        }) as WorkoutMetrics;

        const cues = getRealtimeCues({
          phaseId: definition.initialPhase,
          metrics: neutralMetrics as never,
        });

        expect(cues).not.toBeNull();
        expect(cues!.length).toBeGreaterThan(0);
        expect(cues![0]!.trim().length).toBeGreaterThan(0);
      },
    );
  });
});

// =============================================================================
// staticCues — every phase has a non-empty staticCue
// =============================================================================

describe('staticCues', () => {
  test.each(allWorkouts)(
    '%s: every phase has a non-empty staticCue',
    (_mode, definition) => {
      expect(definition.phases.length).toBeGreaterThan(0);
      for (const phase of definition.phases) {
        expect(phase.staticCue).toBeTruthy();
        expect(typeof phase.staticCue).toBe('string');
        expect(phase.staticCue.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(allWorkouts)(
    '%s: phase ids are unique within the workout',
    (_mode, definition) => {
      const ids = definition.phases.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

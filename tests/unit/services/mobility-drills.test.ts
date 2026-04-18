import {
  MOBILITY_DRILLS,
  getMobilityDrill,
  pickMobilityDrill,
} from '@/lib/services/mobility-drills';

describe('mobility-drills', () => {
  describe('MOBILITY_DRILLS catalog', () => {
    it('exposes ten unique drills', () => {
      const ids = MOBILITY_DRILLS.map((d) => d.id);
      expect(ids.length).toBe(10);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every drill has positive duration and non-empty steps', () => {
      for (const drill of MOBILITY_DRILLS) {
        expect(drill.durationSeconds).toBeGreaterThan(0);
        expect(drill.steps.length).toBeGreaterThan(0);
        expect(drill.muscleTags.length).toBeGreaterThan(0);
      }
    });

    it('every drill declares a recognized intensity level', () => {
      for (const drill of MOBILITY_DRILLS) {
        expect(['low', 'moderate']).toContain(drill.intensity);
      }
    });
  });

  describe('getMobilityDrill', () => {
    it('returns the drill with matching id', () => {
      expect(getMobilityDrill('cat-cow').id).toBe('cat-cow');
      expect(getMobilityDrill('dead-bug').name).toBe('Dead Bug');
    });

    it('throws for an unknown id', () => {
      expect(() => getMobilityDrill('unknown-drill' as 'cat-cow')).toThrow(
        /Unknown mobility drill/,
      );
    });
  });

  describe('pickMobilityDrill', () => {
    it('matches chest exercises to a chest-tagged drill', () => {
      const pick = pickMobilityDrill({ muscleGroup: 'chest', restSeconds: 90 });
      expect(pick.muscleTags).toEqual(expect.arrayContaining(['chest']));
    });

    it('is case-insensitive and tolerates trailing spaces', () => {
      const pick = pickMobilityDrill({ muscleGroup: '  SHOULDERS ', restSeconds: 90 });
      expect(pick.muscleTags.some((tag) => tag === 'shoulders' || tag === 'upper')).toBe(true);
    });

    it('returns the first non-excluded drill that still fits the rest window', () => {
      const first = pickMobilityDrill({ muscleGroup: 'back', restSeconds: 120 });
      const second = pickMobilityDrill({
        muscleGroup: 'back',
        restSeconds: 120,
        previouslyShownIds: [first.id],
      });
      expect(second.id).not.toBe(first.id);
    });

    it('skips drills that would exceed the remaining rest window', () => {
      const pick = pickMobilityDrill({ muscleGroup: 'legs', restSeconds: 36 });
      expect(pick.durationSeconds).toBeLessThanOrEqual(36);
    });

    it('falls back to any drill when muscle group is unknown', () => {
      const pick = pickMobilityDrill({ muscleGroup: 'tail-feathers', restSeconds: 120 });
      expect(pick).toBeDefined();
      expect(pick.id).toBeDefined();
    });

    it('falls back to any drill when muscle group is null', () => {
      const pick = pickMobilityDrill({ muscleGroup: null, restSeconds: 120 });
      expect(pick).toBeDefined();
    });

    it('returns the fallback drill when every catalog drill is excluded', () => {
      const pick = pickMobilityDrill({
        muscleGroup: 'chest',
        restSeconds: 500,
        previouslyShownIds: MOBILITY_DRILLS.map((d) => d.id),
      });
      expect(pick.id).toBe('cat-cow');
      expect(pick.muscleTags).toContain('full-body');
    });

    it('returns a drill even with zero rest seconds (no duration filter applied)', () => {
      const pick = pickMobilityDrill({ muscleGroup: 'back', restSeconds: 0 });
      expect(pick).toBeDefined();
    });
  });
});

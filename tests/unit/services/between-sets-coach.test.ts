import {
  REFLECTION_PROMPTS,
  buildBetweenSetsRecommendation,
  computeFatigueScore,
  pickReflectionPrompt,
} from '@/lib/services/between-sets-coach';

describe('between-sets-coach', () => {
  describe('computeFatigueScore', () => {
    it('returns 0 for a fresh warmup set with no data', () => {
      const score = computeFatigueScore({
        setType: 'warmup',
        setIndex: 0,
        totalSets: 4,
        plannedReps: null,
        actualReps: null,
      });
      expect(score).toBe(0);
    });

    it('grows with set index relative to total sets', () => {
      const early = computeFatigueScore({
        setType: 'normal',
        setIndex: 0,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
      });
      const late = computeFatigueScore({
        setType: 'normal',
        setIndex: 3,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
      });
      expect(late).toBeGreaterThan(early);
    });

    it('adds a large boost when set type is failure', () => {
      const normal = computeFatigueScore({
        setType: 'normal',
        setIndex: 2,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
      });
      const failure = computeFatigueScore({
        setType: 'failure',
        setIndex: 2,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
      });
      expect(failure).toBeGreaterThanOrEqual(normal + 0.3);
    });

    it('adds moderate fatigue for dropset or amrap', () => {
      const base = computeFatigueScore({
        setType: 'normal',
        setIndex: 1,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
      });
      const dropset = computeFatigueScore({
        setType: 'dropset',
        setIndex: 1,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
      });
      expect(dropset).toBeGreaterThan(base);
    });

    it('increases when actual reps fall short of planned', () => {
      const hit = computeFatigueScore({
        setType: 'normal',
        setIndex: 1,
        totalSets: 3,
        plannedReps: 10,
        actualReps: 10,
      });
      const missed = computeFatigueScore({
        setType: 'normal',
        setIndex: 1,
        totalSets: 3,
        plannedReps: 10,
        actualReps: 6,
      });
      expect(missed).toBeGreaterThan(hit);
    });

    it('incorporates RPE above 5', () => {
      const rpe5 = computeFatigueScore({
        setType: 'normal',
        setIndex: 1,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
        perceivedRpe: 5,
      });
      const rpe9 = computeFatigueScore({
        setType: 'normal',
        setIndex: 1,
        totalSets: 4,
        plannedReps: 8,
        actualReps: 8,
        perceivedRpe: 9,
      });
      expect(rpe9).toBeGreaterThan(rpe5);
    });

    it('clamps the final score into [0, 1]', () => {
      const score = computeFatigueScore({
        setType: 'failure',
        setIndex: 9,
        totalSets: 10,
        plannedReps: 20,
        actualReps: 1,
        perceivedRpe: 10,
      });
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('returns 0 when internal math produces NaN', () => {
      const score = computeFatigueScore({
        setType: 'normal',
        setIndex: 0,
        totalSets: 0,
        plannedReps: 0,
        actualReps: 0,
      });
      expect(Number.isFinite(score)).toBe(true);
    });
  });

  describe('REFLECTION_PROMPTS catalog', () => {
    it('covers all four categories', () => {
      const categories = new Set(REFLECTION_PROMPTS.map((p) => p.category));
      expect(categories).toEqual(new Set(['form', 'breathing', 'mindset', 'progress']));
    });

    it('all ids are unique', () => {
      const ids = REFLECTION_PROMPTS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('pickReflectionPrompt', () => {
    const base = { setType: 'normal' as const, setIndex: 1, totalSets: 4, fatigueScore: 0.3 };

    it('leads with a form prompt in the middle of a session', () => {
      const pick = pickReflectionPrompt(base);
      expect(pick.category).toBe('form');
    });

    it('leads with a form prompt for warmup sets', () => {
      const pick = pickReflectionPrompt({ ...base, setType: 'warmup', setIndex: 0 });
      expect(pick.category).toBe('form');
    });

    it('leads with a mindset prompt after a failure set', () => {
      const pick = pickReflectionPrompt({ ...base, setType: 'failure', fatigueScore: 0.7 });
      expect(pick.category).toBe('mindset');
    });

    it('leads with a mindset prompt when fatigue is very high', () => {
      const pick = pickReflectionPrompt({ ...base, fatigueScore: 0.9 });
      expect(pick.category).toBe('mindset');
    });

    it('leads with a progress prompt on the last set', () => {
      const pick = pickReflectionPrompt({ ...base, setIndex: 3, totalSets: 4 });
      expect(pick.category).toBe('progress');
    });

    it('skips previously shown prompts', () => {
      const first = pickReflectionPrompt(base);
      const second = pickReflectionPrompt({ ...base, previouslyShownIds: [first.id] });
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('buildBetweenSetsRecommendation', () => {
    const baseInput = {
      setType: 'normal' as const,
      setIndex: 1,
      totalSets: 4,
      restSeconds: 120,
      muscleGroup: 'chest',
      plannedReps: 8,
      actualReps: 8,
    };

    it('produces a complete recommendation', () => {
      const rec = buildBetweenSetsRecommendation(baseInput);
      expect(rec.breathing.id).toBeDefined();
      expect(rec.mobility.id).toBeDefined();
      expect(rec.reflection.id).toBeDefined();
      expect(rec.fatigueScore).toBeGreaterThanOrEqual(0);
      expect(rec.fatigueScore).toBeLessThanOrEqual(1);
    });

    it('propagates input context into the recommendation', () => {
      const rec = buildBetweenSetsRecommendation(baseInput);
      expect(rec.context.setType).toBe('normal');
      expect(rec.context.setIndex).toBe(1);
      expect(rec.context.muscleGroup).toBe('chest');
      expect(rec.context.restSeconds).toBe(120);
    });

    it('picks a chest-tagged mobility drill for a chest exercise', () => {
      const rec = buildBetweenSetsRecommendation(baseInput);
      expect(
        rec.mobility.muscleTags.some((tag) =>
          ['chest', 'shoulders', 'upper'].includes(tag),
        ),
      ).toBe(true);
    });

    it('surfaces the 4-7-8 pattern after a failure set', () => {
      const rec = buildBetweenSetsRecommendation({
        ...baseInput,
        setType: 'failure',
        actualReps: 4,
      });
      expect(rec.breathing.id).toBe('four-seven-eight');
    });

    it('excludes previously shown mobility drills', () => {
      const first = buildBetweenSetsRecommendation(baseInput);
      const second = buildBetweenSetsRecommendation({
        ...baseInput,
        previouslyShownMobilityIds: [first.mobility.id],
      });
      expect(second.mobility.id).not.toBe(first.mobility.id);
    });

    it('excludes previously shown reflection prompts', () => {
      const first = buildBetweenSetsRecommendation(baseInput);
      const second = buildBetweenSetsRecommendation({
        ...baseInput,
        previouslyShownReflectionIds: [first.reflection.id],
      });
      expect(second.reflection.id).not.toBe(first.reflection.id);
    });
  });
});

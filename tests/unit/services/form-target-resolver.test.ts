import {
  DEFAULT_FORM_TARGETS,
  getDefaultsForExercise,
  hasFormTargetDefaults,
  resolveFormTargets,
  type FormTargets,
} from '@/lib/services/form-target-resolver';
import type { WorkoutTemplate, WorkoutTemplateExercise } from '@/lib/types/workout-session';

function mkExercise(overrides: Partial<WorkoutTemplateExercise> & Pick<WorkoutTemplateExercise, 'exercise_id'>): WorkoutTemplateExercise {
  return {
    id: 'te-1',
    template_id: 't-1',
    sort_order: 0,
    notes: null,
    default_rest_seconds: null,
    default_tempo: null,
    created_at: '2026-04-16T00:00:00.000Z',
    updated_at: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

function mkTemplate(exercises: WorkoutTemplateExercise[]): WorkoutTemplate & { exercises: WorkoutTemplateExercise[] } {
  return {
    id: 't-1',
    user_id: 'u-1',
    name: 'Test Template',
    description: null,
    goal_profile: 'hypertrophy',
    is_public: false,
    share_slug: null,
    created_at: '2026-04-16T00:00:00.000Z',
    updated_at: '2026-04-16T00:00:00.000Z',
    exercises,
  };
}

describe('form-target-resolver', () => {
  describe('getDefaultsForExercise', () => {
    it('returns pullup defaults with FQI 80 and elbow ROM 85-150', () => {
      const t = getDefaultsForExercise('pullup');
      expect(t.fqiMin).toBe(80);
      expect(t.romMin).toBe(85);
      expect(t.romMax).toBe(150);
    });

    it('is case-insensitive', () => {
      expect(getDefaultsForExercise('PullUp')).toEqual(getDefaultsForExercise('pullup'));
    });

    it('returns DEFAULT_FORM_TARGETS for unknown exercise', () => {
      const t = getDefaultsForExercise('unknown-xyz');
      expect(t).toEqual(DEFAULT_FORM_TARGETS);
    });

    it('returns DEFAULT_FORM_TARGETS for empty string', () => {
      expect(getDefaultsForExercise('')).toEqual(DEFAULT_FORM_TARGETS);
    });

    it('returns DEFAULT_FORM_TARGETS for non-string input', () => {
      // @ts-expect-error — exercising runtime guard
      expect(getDefaultsForExercise(42)).toEqual(DEFAULT_FORM_TARGETS);
    });
  });

  describe('hasFormTargetDefaults', () => {
    it('returns true for known exercises', () => {
      expect(hasFormTargetDefaults('squat')).toBe(true);
      expect(hasFormTargetDefaults('deadlift')).toBe(true);
    });

    it('returns false for unknown / empty exerciseId', () => {
      expect(hasFormTargetDefaults('unknown')).toBe(false);
      expect(hasFormTargetDefaults('')).toBe(false);
    });
  });

  describe('resolveFormTargets without template', () => {
    it('returns exercise defaults', () => {
      const t = resolveFormTargets('pullup');
      expect(t).toEqual(getDefaultsForExercise('pullup'));
    });

    it('accepts null template', () => {
      expect(resolveFormTargets('pullup', null)).toEqual(getDefaultsForExercise('pullup'));
    });

    it('falls back to baseline for unknown exercise', () => {
      expect(resolveFormTargets('unknown')).toEqual(DEFAULT_FORM_TARGETS);
    });
  });

  describe('resolveFormTargets with template overrides', () => {
    it('applies full override when all three fields are set', () => {
      const tpl = mkTemplate([
        mkExercise({
          exercise_id: 'pullup',
          target_fqi_min: 90,
          target_rom_min: 70,
          target_rom_max: 140,
        }),
      ]);
      expect(resolveFormTargets('pullup', tpl)).toEqual<FormTargets>({
        fqiMin: 90,
        romMin: 70,
        romMax: 140,
      });
    });

    it('merges partial override with defaults (only FQI overridden)', () => {
      const tpl = mkTemplate([
        mkExercise({ exercise_id: 'pullup', target_fqi_min: 95 }),
      ]);
      const base = getDefaultsForExercise('pullup');
      expect(resolveFormTargets('pullup', tpl)).toEqual<FormTargets>({
        fqiMin: 95,
        romMin: base.romMin,
        romMax: base.romMax,
      });
    });

    it('ignores override for a different exercise', () => {
      const tpl = mkTemplate([
        mkExercise({ exercise_id: 'squat', target_fqi_min: 95 }),
      ]);
      expect(resolveFormTargets('pullup', tpl)).toEqual(getDefaultsForExercise('pullup'));
    });

    it('ignores NaN / non-finite override values', () => {
      const tpl = mkTemplate([
        mkExercise({
          exercise_id: 'pullup',
          target_fqi_min: Number.NaN,
          target_rom_min: Number.POSITIVE_INFINITY,
        }),
      ]);
      const base = getDefaultsForExercise('pullup');
      expect(resolveFormTargets('pullup', tpl)).toEqual(base);
    });

    it('ignores undefined / null override values', () => {
      const tpl = mkTemplate([
        mkExercise({
          exercise_id: 'pullup',
          target_fqi_min: undefined,
          target_rom_min: undefined,
          target_rom_max: undefined,
        }),
      ]);
      expect(resolveFormTargets('pullup', tpl)).toEqual(getDefaultsForExercise('pullup'));
    });

    it('handles empty exercises array', () => {
      const tpl = mkTemplate([]);
      expect(resolveFormTargets('pullup', tpl)).toEqual(getDefaultsForExercise('pullup'));
    });

    it('handles template without exercises field', () => {
      const tpl = { ...mkTemplate([]) } as WorkoutTemplate;
      // Strip exercises to simulate legacy shape
      // @ts-expect-error — runtime guard
      delete tpl.exercises;
      expect(resolveFormTargets('pullup', tpl)).toEqual(getDefaultsForExercise('pullup'));
    });
  });
});

import {
  DEFAULT_FORM_TARGETS,
  __resetUnknownExerciseLogForTests,
  getDefaultsForExercise,
  getDefaultsForExerciseWithFlag,
  hasFormTargetDefaults,
  resolveFormTargets,
  resolveFormTargetsWithFlag,
  type FormTargets,
} from '@/lib/services/form-target-resolver';
import * as ErrorHandler from '@/lib/services/ErrorHandler';
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

  // ---------------------------------------------------------------------------
  // usingGenericTargets provenance flag + log-once observability (#575 item #8)
  // ---------------------------------------------------------------------------
  describe('generic-targets fallback observability', () => {
    let logErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      __resetUnknownExerciseLogForTests();
      logErrorSpy = jest.spyOn(ErrorHandler, 'logError').mockImplementation(() => {});
    });

    afterEach(() => {
      logErrorSpy.mockRestore();
    });

    it('returns usingGenericTargets=false for a known exercise', () => {
      const r = getDefaultsForExerciseWithFlag('pullup');
      expect(r.usingGenericTargets).toBe(false);
      expect(r.targets.fqiMin).toBe(80);
      expect(logErrorSpy).not.toHaveBeenCalled();
    });

    it('returns usingGenericTargets=true for an unknown exerciseId', () => {
      const r = getDefaultsForExerciseWithFlag('pullups'); // common typo
      expect(r.usingGenericTargets).toBe(true);
      expect(r.targets).toEqual(DEFAULT_FORM_TARGETS);
    });

    it('logs once per unknown exerciseId (not on every call)', () => {
      getDefaultsForExerciseWithFlag('pullups');
      getDefaultsForExerciseWithFlag('pullups');
      getDefaultsForExerciseWithFlag('pullups');
      expect(logErrorSpy).toHaveBeenCalledTimes(1);
      const [err, ctx] = logErrorSpy.mock.calls[0];
      expect(err.domain).toBe('form-tracking');
      expect(err.code).toBe('FORM_TARGET_FALLBACK_GENERIC');
      expect(err.severity).toBe('warning');
      expect(ctx).toEqual({
        feature: 'form-tracking',
        location: 'lib/services/form-target-resolver',
      });
    });

    it('logs a separate entry per distinct unknown id', () => {
      getDefaultsForExerciseWithFlag('pullups');
      getDefaultsForExerciseWithFlag('squats');
      expect(logErrorSpy).toHaveBeenCalledTimes(2);
    });

    it('logs for empty/non-string exerciseId (invalid-id reason)', () => {
      getDefaultsForExerciseWithFlag('');
      expect(logErrorSpy).toHaveBeenCalledTimes(1);
      const [err] = logErrorSpy.mock.calls[0];
      expect((err.details as { reason: string }).reason).toBe('invalid-id');
    });

    it('legacy getDefaultsForExercise still returns the same FormTargets', () => {
      __resetUnknownExerciseLogForTests();
      expect(getDefaultsForExercise('pullup')).toEqual<FormTargets>(
        getDefaultsForExerciseWithFlag('pullup').targets,
      );
      expect(getDefaultsForExercise('unknown')).toEqual(DEFAULT_FORM_TARGETS);
    });

    it('resolveFormTargetsWithFlag propagates usingGenericTargets from baseline', () => {
      const r = resolveFormTargetsWithFlag('unknown-xyz');
      expect(r.usingGenericTargets).toBe(true);
      expect(r.targets).toEqual(DEFAULT_FORM_TARGETS);
    });

    it('resolveFormTargetsWithFlag surfaces override targets while still flagging unknown id', () => {
      const tpl = mkTemplate([
        mkExercise({ exercise_id: 'unknown-xyz', target_fqi_min: 88 }),
      ]);
      const r = resolveFormTargetsWithFlag('unknown-xyz', tpl);
      expect(r.usingGenericTargets).toBe(true);
      expect(r.targets.fqiMin).toBe(88);
      // ROM axes inherit from the generic baseline.
      expect(r.targets.romMin).toBe(DEFAULT_FORM_TARGETS.romMin);
      expect(r.targets.romMax).toBe(DEFAULT_FORM_TARGETS.romMax);
    });

    it('resolveFormTargetsWithFlag reports usingGenericTargets=false for known exercise', () => {
      const r = resolveFormTargetsWithFlag('pullup');
      expect(r.usingGenericTargets).toBe(false);
    });
  });
});

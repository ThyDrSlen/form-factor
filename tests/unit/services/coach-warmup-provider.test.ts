jest.mock('@/lib/services/warmup-generator', () => ({
  generateWarmup: jest.fn(),
}));

import { generateWarmup as generateWarmupMock } from '@/lib/services/warmup-generator';
import {
  buildGeneratorInput,
  buildWarmupForSession,
  isWarmupCoachFlowEnabled,
} from '@/lib/services/coach-warmup-provider';
import { WARMUP_COACH_FLAG_ENV_VAR } from '@/lib/services/warmup-coach-flag';
import type { WarmupPlan } from '@/lib/services/coach-warmup-provider';

const generateWarmupSpy = generateWarmupMock as jest.MockedFunction<typeof generateWarmupMock>;

const FAKE_PLAN: WarmupPlan = {
  name: 'Squat day warmup',
  duration_min: 6,
  movements: [
    { name: 'Hip flow', focus: 'mobility', intensity: 'low', duration_seconds: 60 },
    { name: 'Goblet squat', focus: 'activation', intensity: 'medium', reps: 10 },
  ],
};

describe('buildGeneratorInput', () => {
  it('prefers explicit exerciseSlugs', () => {
    const result = buildGeneratorInput({
      exerciseSlugs: ['back_squat', 'Dead Lift'],
      durationMin: 7,
    });
    expect(result.exerciseSlugs).toEqual(['back_squat', 'dead_lift']);
    expect(result.durationMin).toBe(7);
  });

  it('falls back to exercises.name + exercises.slug', () => {
    const result = buildGeneratorInput({
      exercises: [{ name: 'Bench Press' }, { slug: 'overhead_press' }],
    });
    expect(result.exerciseSlugs).toEqual(['bench_press', 'overhead_press']);
  });

  it('drops empty / non-string entries', () => {
    const result = buildGeneratorInput({
      exerciseSlugs: ['good', '', undefined as unknown as string],
    });
    expect(result.exerciseSlugs).toEqual(['good']);
  });

  it('trims whitespace-only userContext to undefined', () => {
    const result = buildGeneratorInput({ exerciseSlugs: ['a'], userContext: '   ' });
    expect(result.userContext).toBeUndefined();
  });

  it('preserves non-empty userContext', () => {
    const result = buildGeneratorInput({
      exerciseSlugs: ['a'],
      userContext: 'left shoulder stiff',
    });
    expect(result.userContext).toBe('left shoulder stiff');
  });
});

describe('buildWarmupForSession', () => {
  const originalFlag = process.env[WARMUP_COACH_FLAG_ENV_VAR];

  beforeEach(() => {
    generateWarmupSpy.mockReset();
    generateWarmupSpy.mockResolvedValue(FAKE_PLAN);
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    } else {
      process.env[WARMUP_COACH_FLAG_ENV_VAR] = originalFlag;
    }
  });

  it('returns null when the flag is off — never calls the generator', async () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    const result = await buildWarmupForSession({ exerciseSlugs: ['squat'] });
    expect(result).toBeNull();
    expect(generateWarmupSpy).not.toHaveBeenCalled();
  });

  it('returns null when no exercises resolve — never calls the generator', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    const result = await buildWarmupForSession({ exerciseSlugs: [] });
    expect(result).toBeNull();
    expect(generateWarmupSpy).not.toHaveBeenCalled();
  });

  it('calls the generator with normalized input when flag on', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = 'true';
    const result = await buildWarmupForSession({
      exerciseSlugs: ['Back Squat', 'Dead Lift'],
      durationMin: 5,
      userContext: 'tight hips',
    });
    expect(result).toEqual(FAKE_PLAN);
    expect(generateWarmupSpy).toHaveBeenCalledTimes(1);
    const [input] = generateWarmupSpy.mock.calls[0];
    expect(input).toEqual({
      exerciseSlugs: ['back_squat', 'dead_lift'],
      durationMin: 5,
      userContext: 'tight hips',
    });
  });

  it('uses generatorOverride when provided (test seam)', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    const override = jest.fn(() => Promise.resolve(FAKE_PLAN));
    const result = await buildWarmupForSession(
      { exerciseSlugs: ['squat'] },
      { generatorOverride: override },
    );
    expect(result).toEqual(FAKE_PLAN);
    expect(override).toHaveBeenCalledTimes(1);
    expect(generateWarmupSpy).not.toHaveBeenCalled();
  });

  it('bypassFlag lets tests run without setting env', async () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    const result = await buildWarmupForSession(
      { exerciseSlugs: ['squat'] },
      { bypassFlag: true },
    );
    expect(result).toEqual(FAKE_PLAN);
    expect(generateWarmupSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates generator errors', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    generateWarmupSpy.mockRejectedValueOnce(new Error('schema mismatch'));
    await expect(
      buildWarmupForSession({ exerciseSlugs: ['squat'] }),
    ).rejects.toThrow('schema mismatch');
  });
});

describe('isWarmupCoachFlowEnabled', () => {
  const originalFlag = process.env[WARMUP_COACH_FLAG_ENV_VAR];

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    } else {
      process.env[WARMUP_COACH_FLAG_ENV_VAR] = originalFlag;
    }
  });

  it('mirrors the flag', () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    expect(isWarmupCoachFlowEnabled()).toBe(false);
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    expect(isWarmupCoachFlowEnabled()).toBe(true);
  });
});

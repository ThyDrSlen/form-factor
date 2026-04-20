jest.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: () => `fb-uuid-${++counter}` };
});

import {
  durationBucket,
  getSessionFallbackShape,
  getSessionFallback,
  listSessionFallbackKeys,
  getWarmupFallback,
  getCooldownFallback,
  withFallback,
} from '@/lib/services/session-generator-fallback';
import { SESSION_GENERATOR_SCHEMA } from '@/lib/services/session-generator';
import { WARMUP_PLAN_SCHEMA } from '@/lib/services/warmup-generator';
import { COOLDOWN_PLAN_SCHEMA } from '@/lib/services/cooldown-generator';

describe('durationBucket', () => {
  it('classifies durations correctly', () => {
    expect(durationBucket(10)).toBe('under_20');
    expect(durationBucket(30)).toBe('20_45');
    expect(durationBucket(60)).toBe('45_75');
    expect(durationBucket(90)).toBe('over_75');
    expect(durationBucket()).toBe('20_45'); // default
  });
});

describe('session fallback library', () => {
  it('has at least 12 templates', () => {
    expect(listSessionFallbackKeys().length).toBeGreaterThanOrEqual(12);
  });

  it('every entry passes SESSION_GENERATOR_SCHEMA', () => {
    for (const key of listSessionFallbackKeys()) {
      const [goal, bucket] = key.split(':') as [string, string];
      const shape = getSessionFallbackShape({
        goalProfile: goal as never,
        durationMin: bucket === 'under_20' ? 10 : bucket === '20_45' ? 30 : bucket === '45_75' ? 60 : 90,
      });
      const result = SESSION_GENERATOR_SCHEMA.validate(shape);
      if (!result.ok) {
        throw new Error(`schema failed for ${key}: ${JSON.stringify(result.issues)}`);
      }
    }
  });

  it('every entry has reasonable rep/set counts', () => {
    for (const key of listSessionFallbackKeys()) {
      const [goal, bucket] = key.split(':') as [string, string];
      const shape = getSessionFallbackShape({
        goalProfile: goal as never,
        durationMin: bucket === 'under_20' ? 10 : bucket === '20_45' ? 30 : bucket === '45_75' ? 60 : 90,
      });
      expect(shape.exercises.length).toBeGreaterThanOrEqual(2);
      expect(shape.exercises.length).toBeLessThanOrEqual(8);
      for (const ex of shape.exercises) {
        expect(ex.sets.length).toBeGreaterThanOrEqual(1);
        expect(ex.sets.length).toBeLessThanOrEqual(6);
        for (const s of ex.sets) {
          const hasRepsOrSeconds = s.target_reps != null || s.target_seconds != null;
          expect(hasRepsOrSeconds).toBe(true);
        }
      }
    }
  });

  it('returns deterministic results for the same input', () => {
    const a = getSessionFallbackShape({ goalProfile: 'strength', durationMin: 30 });
    const b = getSessionFallbackShape({ goalProfile: 'strength', durationMin: 30 });
    expect(a).toBe(b);
  });

  it('falls back to hypertrophy:20_45 when goal missing', () => {
    const shape = getSessionFallbackShape({});
    expect(shape.goal_profile).toBe('hypertrophy');
  });

  it('hydrates into a WorkoutTemplate', () => {
    const hydrated = getSessionFallback(
      { goalProfile: 'hypertrophy', durationMin: 30 },
      { userId: 'u1', uuid: (() => { let n = 0; return () => `id-${++n}`; })() },
    );
    expect(hydrated.template.user_id).toBe('u1');
    expect(hydrated.template.goal_profile).toBe('hypertrophy');
    expect(hydrated.exercises.length).toBeGreaterThan(0);
    expect(hydrated.exercises[0].exercise_slug).toBeDefined();
  });
});

describe('warmup / cooldown fallbacks', () => {
  it('warmup fallback passes WARMUP_PLAN_SCHEMA', () => {
    expect(WARMUP_PLAN_SCHEMA.validate(getWarmupFallback()).ok).toBe(true);
  });

  it('cooldown fallback passes COOLDOWN_PLAN_SCHEMA', () => {
    expect(COOLDOWN_PLAN_SCHEMA.validate(getCooldownFallback()).ok).toBe(true);
  });
});

describe('withFallback', () => {
  it('returns fn result when it resolves', async () => {
    const result = await withFallback(
      () => Promise.resolve(42),
      () => 0,
    );
    expect(result).toBe(42);
  });

  it('returns fallback when fn rejects', async () => {
    const onFallback = jest.fn();
    const result = await withFallback(
      () => Promise.reject(new Error('offline')),
      () => 99,
      onFallback,
    );
    expect(result).toBe(99);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('returns fallback when fn throws synchronously', async () => {
    const result = await withFallback(
      async () => {
        throw new Error('boom');
      },
      () => 'safe',
    );
    expect(result).toBe('safe');
  });
});

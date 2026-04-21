import { isWorkoutCoachRecallEnabled } from '@/lib/services/workout-coach-recall-flag';

const FLAG_ENV_VAR = 'EXPO_PUBLIC_WORKOUT_COACH_RECALL';

describe('workout-coach-recall-flag', () => {
  const originalValue = process.env[FLAG_ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[FLAG_ENV_VAR];
    } else {
      process.env[FLAG_ENV_VAR] = originalValue;
    }
  });

  it('returns false when flag is unset', () => {
    delete process.env[FLAG_ENV_VAR];
    expect(isWorkoutCoachRecallEnabled()).toBe(false);
  });

  it('returns true when flag is "1"', () => {
    process.env[FLAG_ENV_VAR] = '1';
    expect(isWorkoutCoachRecallEnabled()).toBe(true);
  });

  it('returns true when flag is "true"', () => {
    process.env[FLAG_ENV_VAR] = 'true';
    expect(isWorkoutCoachRecallEnabled()).toBe(true);
  });

  it('returns false for adjacent truthy-looking strings (strict parse)', () => {
    for (const value of ['on', 'yes', 'TRUE', 'True', 'enabled', '2', 'T', '']) {
      process.env[FLAG_ENV_VAR] = value;
      expect(isWorkoutCoachRecallEnabled()).toBe(false);
    }
  });

  it('returns false for whitespace-padded accepted values', () => {
    for (const value of [' 1 ', ' true ', '1 ', ' true']) {
      process.env[FLAG_ENV_VAR] = value;
      expect(isWorkoutCoachRecallEnabled()).toBe(false);
    }
  });

  it('returns false for "0" and "false"', () => {
    for (const value of ['0', 'false', 'off', 'no']) {
      process.env[FLAG_ENV_VAR] = value;
      expect(isWorkoutCoachRecallEnabled()).toBe(false);
    }
  });
});

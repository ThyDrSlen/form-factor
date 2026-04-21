import {
  isWarmupCoachEnabled,
  WARMUP_COACH_FLAG_ENV_VAR,
} from '@/lib/services/warmup-coach-flag';

describe('warmup-coach-flag', () => {
  const originalValue = process.env[WARMUP_COACH_FLAG_ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    } else {
      process.env[WARMUP_COACH_FLAG_ENV_VAR] = originalValue;
    }
  });

  it('returns false when unset', () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    expect(isWarmupCoachEnabled()).toBe(false);
  });

  it('returns true for "1"', () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    expect(isWarmupCoachEnabled()).toBe(true);
  });

  it('returns true for "true"', () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = 'true';
    expect(isWarmupCoachEnabled()).toBe(true);
  });

  it('returns false for adjacent truthy-looking strings', () => {
    for (const value of ['yes', 'on', 'TRUE', 'True', 'ON', '0', 'false', 'enabled', '']) {
      process.env[WARMUP_COACH_FLAG_ENV_VAR] = value;
      expect(isWarmupCoachEnabled()).toBe(false);
    }
  });

  it('returns false for whitespace-padded values', () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = ' 1 ';
    expect(isWarmupCoachEnabled()).toBe(false);
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = ' true ';
    expect(isWarmupCoachEnabled()).toBe(false);
  });
});

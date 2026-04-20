import { isCoachVisionEnabled } from '@/lib/services/coach-vision-flag';

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_VISION';

describe('coach-vision-flag', () => {
  const originalValue = process.env[FLAG_ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[FLAG_ENV_VAR];
    } else {
      process.env[FLAG_ENV_VAR] = originalValue;
    }
  });

  it('returns false when EXPO_PUBLIC_COACH_VISION is unset', () => {
    delete process.env[FLAG_ENV_VAR];
    expect(isCoachVisionEnabled()).toBe(false);
  });

  it('returns true when EXPO_PUBLIC_COACH_VISION is "on"', () => {
    process.env[FLAG_ENV_VAR] = 'on';
    expect(isCoachVisionEnabled()).toBe(true);
  });

  it('returns false when EXPO_PUBLIC_COACH_VISION is "off"', () => {
    process.env[FLAG_ENV_VAR] = 'off';
    expect(isCoachVisionEnabled()).toBe(false);
  });

  it('returns false for adjacent truthy-looking strings (strict parse)', () => {
    for (const value of ['true', '1', 'yes', 'ON', 'On', 'enabled', '']) {
      process.env[FLAG_ENV_VAR] = value;
      expect(isCoachVisionEnabled()).toBe(false);
    }
  });

  it('returns false for whitespace-padded "on"', () => {
    process.env[FLAG_ENV_VAR] = ' on ';
    expect(isCoachVisionEnabled()).toBe(false);
  });
});

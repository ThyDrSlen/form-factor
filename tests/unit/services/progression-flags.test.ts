import {
  PROGRESSION_FLAG_ENV_VARS,
  isOverloadCardEnabled,
  isProgressionPlanEnabled,
} from '@/lib/services/progression-flags';

const OVERLOAD_CARD = PROGRESSION_FLAG_ENV_VARS.overloadCard;
const PROGRESSION_PLAN = PROGRESSION_FLAG_ENV_VARS.progressionPlan;

describe('progression-flags', () => {
  const originalOverload = process.env[OVERLOAD_CARD];
  const originalPlan = process.env[PROGRESSION_PLAN];

  afterEach(() => {
    if (originalOverload === undefined) {
      delete process.env[OVERLOAD_CARD];
    } else {
      process.env[OVERLOAD_CARD] = originalOverload;
    }
    if (originalPlan === undefined) {
      delete process.env[PROGRESSION_PLAN];
    } else {
      process.env[PROGRESSION_PLAN] = originalPlan;
    }
  });

  describe('isOverloadCardEnabled', () => {
    it('returns false when EXPO_PUBLIC_OVERLOAD_CARD is unset', () => {
      delete process.env[OVERLOAD_CARD];
      expect(isOverloadCardEnabled()).toBe(false);
    });

    it('returns true when EXPO_PUBLIC_OVERLOAD_CARD is "on"', () => {
      process.env[OVERLOAD_CARD] = 'on';
      expect(isOverloadCardEnabled()).toBe(true);
    });

    it('returns false when EXPO_PUBLIC_OVERLOAD_CARD is "off"', () => {
      process.env[OVERLOAD_CARD] = 'off';
      expect(isOverloadCardEnabled()).toBe(false);
    });

    it('returns false for adjacent truthy-looking strings (strict parse)', () => {
      for (const value of ['true', '1', 'yes', 'ON', 'On', 'enabled', '']) {
        process.env[OVERLOAD_CARD] = value;
        expect(isOverloadCardEnabled()).toBe(false);
      }
    });

    it('returns false for whitespace-padded "on"', () => {
      process.env[OVERLOAD_CARD] = ' on ';
      expect(isOverloadCardEnabled()).toBe(false);
    });
  });

  describe('isProgressionPlanEnabled', () => {
    it('returns false when EXPO_PUBLIC_PROGRESSION_PLAN is unset', () => {
      delete process.env[PROGRESSION_PLAN];
      expect(isProgressionPlanEnabled()).toBe(false);
    });

    it('returns true when EXPO_PUBLIC_PROGRESSION_PLAN is "on"', () => {
      process.env[PROGRESSION_PLAN] = 'on';
      expect(isProgressionPlanEnabled()).toBe(true);
    });

    it('returns false when EXPO_PUBLIC_PROGRESSION_PLAN is "off"', () => {
      process.env[PROGRESSION_PLAN] = 'off';
      expect(isProgressionPlanEnabled()).toBe(false);
    });

    it('returns false for adjacent truthy-looking strings (strict parse)', () => {
      for (const value of ['true', '1', 'yes', 'ON', 'On', 'enabled', '']) {
        process.env[PROGRESSION_PLAN] = value;
        expect(isProgressionPlanEnabled()).toBe(false);
      }
    });
  });

  describe('independence', () => {
    it('toggling one flag does not affect the other', () => {
      process.env[OVERLOAD_CARD] = 'on';
      delete process.env[PROGRESSION_PLAN];
      expect(isOverloadCardEnabled()).toBe(true);
      expect(isProgressionPlanEnabled()).toBe(false);

      delete process.env[OVERLOAD_CARD];
      process.env[PROGRESSION_PLAN] = 'on';
      expect(isOverloadCardEnabled()).toBe(false);
      expect(isProgressionPlanEnabled()).toBe(true);
    });
  });
});

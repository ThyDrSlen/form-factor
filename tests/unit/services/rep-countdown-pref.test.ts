import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  REP_COUNTDOWN_STORAGE_KEY,
  getRepCountdownDefault,
  getRepCountdownEnabled,
  setRepCountdownEnabled,
} from '@/lib/services/rep-countdown-pref';

describe('rep-countdown-pref', () => {
  const prevFlag = process.env.EXPO_PUBLIC_REP_COUNTDOWN;

  beforeEach(async () => {
    await AsyncStorage.clear();
    delete process.env.EXPO_PUBLIC_REP_COUNTDOWN;
  });

  afterAll(() => {
    if (prevFlag === undefined) {
      delete process.env.EXPO_PUBLIC_REP_COUNTDOWN;
    } else {
      process.env.EXPO_PUBLIC_REP_COUNTDOWN = prevFlag;
    }
  });

  describe('getRepCountdownDefault', () => {
    it('returns true when the env flag is unset', () => {
      expect(getRepCountdownDefault()).toBe(true);
    });

    it('returns true when the env flag is explicitly "on"', () => {
      process.env.EXPO_PUBLIC_REP_COUNTDOWN = 'on';
      expect(getRepCountdownDefault()).toBe(true);
    });

    it('returns false when the env flag is "off"', () => {
      process.env.EXPO_PUBLIC_REP_COUNTDOWN = 'off';
      expect(getRepCountdownDefault()).toBe(false);
    });

    it('is case-insensitive for "off"', () => {
      process.env.EXPO_PUBLIC_REP_COUNTDOWN = 'OFF';
      expect(getRepCountdownDefault()).toBe(false);
    });
  });

  describe('getRepCountdownEnabled', () => {
    it('defaults to true when nothing is stored', async () => {
      await expect(getRepCountdownEnabled()).resolves.toBe(true);
    });

    it('returns the stored "true" value', async () => {
      await setRepCountdownEnabled(true);
      await expect(getRepCountdownEnabled()).resolves.toBe(true);
    });

    it('returns the stored "false" value', async () => {
      await setRepCountdownEnabled(false);
      await expect(getRepCountdownEnabled()).resolves.toBe(false);
    });

    it('falls back to the default when the stored value is corrupt', async () => {
      await AsyncStorage.setItem(REP_COUNTDOWN_STORAGE_KEY, 'not-a-bool');
      await expect(getRepCountdownEnabled()).resolves.toBe(true);
    });

    it('honors an env override of "off" when nothing is stored', async () => {
      process.env.EXPO_PUBLIC_REP_COUNTDOWN = 'off';
      await expect(getRepCountdownEnabled()).resolves.toBe(false);
    });

    it('user override beats env default', async () => {
      process.env.EXPO_PUBLIC_REP_COUNTDOWN = 'off';
      await setRepCountdownEnabled(true);
      await expect(getRepCountdownEnabled()).resolves.toBe(true);
    });
  });

  describe('setRepCountdownEnabled', () => {
    it('persists the toggle across calls', async () => {
      await setRepCountdownEnabled(false);
      await expect(getRepCountdownEnabled()).resolves.toBe(false);
      await setRepCountdownEnabled(true);
      await expect(getRepCountdownEnabled()).resolves.toBe(true);
    });
  });
});

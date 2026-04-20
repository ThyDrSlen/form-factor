import {
  playRepCountdown,
  REP_COUNTDOWN_STEP_MS,
} from '@/lib/services/rep-countdown-audio';
import { setRepCountdownEnabled } from '@/lib/services/rep-countdown-pref';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

describe('playRepCountdown', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('speaks "3 2 1 go" in order when enabled', async () => {
    const speak = jest.fn().mockResolvedValue(undefined);
    const pulse = jest.fn().mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await playRepCountdown({
      forceEnabled: true,
      speak,
      pulse,
      sleep,
    });

    expect(result.played).toBe(true);
    expect(result.spoken).toEqual(['3', '2', '1', 'go']);
    expect(speak).toHaveBeenNthCalledWith(1, '3');
    expect(speak).toHaveBeenNthCalledWith(2, '2');
    expect(speak).toHaveBeenNthCalledWith(3, '1');
    expect(speak).toHaveBeenNthCalledWith(4, 'go');
  });

  it('pulses haptics for each tick + a success pulse on "go"', async () => {
    const pulse = jest.fn().mockResolvedValue(undefined);
    await playRepCountdown({
      forceEnabled: true,
      speak: jest.fn().mockResolvedValue(undefined),
      pulse,
      sleep: jest.fn().mockResolvedValue(undefined),
    });

    expect(pulse).toHaveBeenCalledTimes(4);
    expect(pulse).toHaveBeenNthCalledWith(1, 'tick');
    expect(pulse).toHaveBeenNthCalledWith(2, 'tick');
    expect(pulse).toHaveBeenNthCalledWith(3, 'tick');
    expect(pulse).toHaveBeenNthCalledWith(4, 'go');
  });

  it('waits ~1s between ticks (3 sleeps, not 4)', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    await playRepCountdown({
      forceEnabled: true,
      speak: jest.fn().mockResolvedValue(undefined),
      pulse: jest.fn().mockResolvedValue(undefined),
      sleep,
    });

    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(REP_COUNTDOWN_STEP_MS);
  });

  it('skips when the user preference is disabled', async () => {
    await setRepCountdownEnabled(false);
    const speak = jest.fn();
    const pulse = jest.fn();

    const result = await playRepCountdown({ speak, pulse });
    expect(result.played).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(result.spoken).toEqual([]);
    expect(speak).not.toHaveBeenCalled();
    expect(pulse).not.toHaveBeenCalled();
  });

  it('respects the default-on preference when nothing is stored', async () => {
    const speak = jest.fn().mockResolvedValue(undefined);
    const result = await playRepCountdown({
      speak,
      pulse: jest.fn().mockResolvedValue(undefined),
      sleep: jest.fn().mockResolvedValue(undefined),
    });
    expect(result.played).toBe(true);
    expect(speak).toHaveBeenCalledTimes(4);
  });

  it('forceEnabled bypasses a stored "false" preference', async () => {
    await setRepCountdownEnabled(false);
    const speak = jest.fn().mockResolvedValue(undefined);

    const result = await playRepCountdown({
      forceEnabled: true,
      speak,
      pulse: jest.fn().mockResolvedValue(undefined),
      sleep: jest.fn().mockResolvedValue(undefined),
    });
    expect(result.played).toBe(true);
    expect(speak).toHaveBeenCalledTimes(4);
  });
});

describe('playRepCountdown (web platform)', () => {
  const originalRN = jest.requireMock('react-native');
  const prevOS = originalRN.Platform.OS;

  beforeAll(() => {
    originalRN.Platform.OS = 'web';
  });

  afterAll(() => {
    originalRN.Platform.OS = prevOS;
  });

  it('is a no-op on web', async () => {
    const speak = jest.fn();
    const result = await playRepCountdown({ forceEnabled: true, speak });
    expect(result.played).toBe(false);
    expect(result.reason).toBe('unsupported_platform');
    expect(speak).not.toHaveBeenCalled();
  });
});

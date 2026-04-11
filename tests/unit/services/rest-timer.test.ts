const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancelScheduledNotificationAsync(...args),
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 'timeInterval',
  },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const restTimer = require('@/lib/services/rest-timer') as typeof import('@/lib/services/rest-timer');

describe('rest-timer', () => {

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T12:00:00.000Z').getTime());
    mockScheduleNotificationAsync.mockResolvedValue('notif-1');
    mockCancelScheduledNotificationAsync.mockResolvedValue(undefined);
    await restTimer.cancelRestNotification();
  });

  afterEach(async () => {
    await restTimer.cancelRestNotification();
    jest.restoreAllMocks();
  });

  it('computes rest seconds from overrides, set types, goal profiles, and RPE modifiers', () => {
    expect(
      restTimer.computeRestSeconds({
        goalProfile: 'strength',
        isCompound: true,
        setType: 'normal',
        overrideSeconds: 95,
      })
    ).toBe(95);

    expect(
      restTimer.computeRestSeconds({
        goalProfile: 'mixed',
        isCompound: true,
        setType: 'warmup',
      })
    ).toBe(60);

    expect(
      restTimer.computeRestSeconds({
        goalProfile: 'mixed',
        isCompound: false,
        setType: 'dropset',
      })
    ).toBe(15);

    expect(
      restTimer.computeRestSeconds({
        goalProfile: 'power',
        isCompound: true,
        setType: 'normal',
        perceivedRpe: 8,
      })
    ).toBe(264);

    expect(
      restTimer.computeRestSeconds({
        goalProfile: 'hypertrophy',
        isCompound: false,
        setType: 'failure',
        perceivedRpe: 9,
      })
    ).toBe(140);
  });

  it('computes remaining seconds across active, expired, and future-start edge cases', () => {
    expect(
      restTimer.computeRemainingSeconds(new Date('2026-01-01T11:59:30.000Z'), 60)
    ).toBe(30);

    expect(
      restTimer.computeRemainingSeconds('2026-01-01T11:58:00.000Z', 30)
    ).toBe(0);

    expect(
      restTimer.computeRemainingSeconds('2026-01-01T12:00:10.000Z', 30)
    ).toBe(40);
  });

  it('formats rest time as MM:SS', () => {
    expect(restTimer.formatRestTime(5)).toBe('0:05');
    expect(restTimer.formatRestTime(65)).toBe('1:05');
    expect(restTimer.formatRestTime(600)).toBe('10:00');
  });

  it('schedules a rest notification with the next set details', async () => {
    const result = await restTimer.scheduleRestNotification(90, 'Back Squat', 3);

    expect(result).toBe('notif-1');
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: 'Rest Complete',
        body: 'Time for set 3 of Back Squat',
        sound: 'default',
        categoryIdentifier: 'rest_timer',
      },
      trigger: {
        type: 'timeInterval',
        seconds: 90,
        repeats: false,
      },
    });
  });

  it('cancels the active rest notification', async () => {
    await restTimer.scheduleRestNotification(45);
    await restTimer.cancelRestNotification();

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it('returns null and does not throw when scheduleNotificationAsync rejects', async () => {
    mockScheduleNotificationAsync.mockRejectedValueOnce(new Error('permission denied'));

    const result = await restTimer.scheduleRestNotification(60, 'Bench Press', 2);

    expect(result).toBeNull();
    // The module should have logged a warning rather than crashing
    const { warnWithTs } = require('@/lib/logger') as typeof import('@/lib/logger');
    expect(warnWithTs).toHaveBeenCalled();
  });

  it('does not throw and clears the stored id when cancelScheduledNotificationAsync rejects', async () => {
    // First schedule so there is an active notification id stored
    await restTimer.scheduleRestNotification(60);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // Make the next cancel call fail
    mockCancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('system error'));

    // Should resolve without throwing
    await expect(restTimer.cancelRestNotification()).resolves.toBeUndefined();

    // A subsequent cancel should NOT try to cancel again (id was cleared)
    await restTimer.cancelRestNotification();
    // cancelScheduledNotificationAsync was called exactly once (the failing call);
    // the second cancelRestNotification is a no-op because id is already null
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('cancelling when no notification is active is a no-op and does not throw', async () => {
    // No scheduleRestNotification has been called in this test, so id is null
    await expect(restTimer.cancelRestNotification()).resolves.toBeUndefined();
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('scheduling a second notification cancels the first before scheduling the new one', async () => {
    // First schedule
    mockScheduleNotificationAsync.mockResolvedValueOnce('notif-A');
    await restTimer.scheduleRestNotification(60, 'Squat', 1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // Second schedule — should cancel 'notif-A' then schedule fresh
    mockScheduleNotificationAsync.mockResolvedValueOnce('notif-B');
    const result = await restTimer.scheduleRestNotification(90, 'Squat', 2);

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-A');
    expect(result).toBe('notif-B');
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('scheduling while a prior schedule fails still stores null and returns null', async () => {
    mockScheduleNotificationAsync.mockRejectedValueOnce(new Error('quota exceeded'));

    const result = await restTimer.scheduleRestNotification(120);

    expect(result).toBeNull();

    // A follow-up cancel should be a no-op (nothing stored)
    await restTimer.cancelRestNotification();
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // computeRestSeconds — boundary / edge case inputs
  // -------------------------------------------------------------------------

  it('treats overrideSeconds = 0 as absent and falls through to goal profile logic', () => {
    const result = restTimer.computeRestSeconds({
      goalProfile: 'strength',
      isCompound: true,
      setType: 'normal',
      overrideSeconds: 0,
    });
    // override is 0, which is NOT > 0, so the strength compound base (210) should apply
    expect(result).toBe(210);
  });

  it('treats overrideSeconds = null as absent', () => {
    const result = restTimer.computeRestSeconds({
      goalProfile: 'endurance',
      isCompound: false,
      setType: 'normal',
      overrideSeconds: null,
    });
    expect(result).toBe(45); // endurance isolation base
  });

  it('applies no RPE modifier when perceivedRpe is null', () => {
    const result = restTimer.computeRestSeconds({
      goalProfile: 'hypertrophy',
      isCompound: true,
      setType: 'normal',
      perceivedRpe: null,
    });
    expect(result).toBe(120); // unmodified hypertrophy compound base
  });

  it('applies no RPE modifier when perceivedRpe is below 8', () => {
    const result = restTimer.computeRestSeconds({
      goalProfile: 'power',
      isCompound: false,
      setType: 'normal',
      perceivedRpe: 7,
    });
    expect(result).toBe(180); // unmodified power isolation base
  });

  it('handles all goal profiles for compound and isolation correctly', () => {
    const cases: Array<[import('@/lib/types/workout-session').GoalProfile, boolean, number]> = [
      ['strength',    true,  210],
      ['strength',    false, 150],
      ['power',       true,  240],
      ['power',       false, 180],
      ['hypertrophy', true,  120],
      ['hypertrophy', false, 90],
      ['endurance',   true,  60],
      ['endurance',   false, 45],
      ['mixed',       true,  120],
      ['mixed',       false, 90],
    ];

    for (const [goalProfile, isCompound, expected] of cases) {
      expect(
        restTimer.computeRestSeconds({ goalProfile, isCompound, setType: 'normal' })
      ).toBe(expected);
    }
  });

  it('applies amrap set-type multiplier (1.3x) on top of goal profile base', () => {
    const result = restTimer.computeRestSeconds({
      goalProfile: 'strength',
      isCompound: true,
      setType: 'amrap',
    });
    expect(result).toBe(Math.round(210 * 1.3)); // 273
  });

  it('applies failure set-type multiplier (1.3x) on top of goal profile base', () => {
    const result = restTimer.computeRestSeconds({
      goalProfile: 'endurance',
      isCompound: false,
      setType: 'failure',
    });
    expect(result).toBe(Math.round(45 * 1.3)); // 59
  });
});

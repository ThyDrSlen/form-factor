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

let restTimer: typeof import('@/lib/services/rest-timer');

describe('rest-timer', () => {
  beforeAll(async () => {
    restTimer = await import('@/lib/services/rest-timer');
  });

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
});

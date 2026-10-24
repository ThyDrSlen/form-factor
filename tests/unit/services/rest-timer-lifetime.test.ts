import * as Notifications from 'expo-notifications';
import { cancelRestNotification, scheduleRestNotification } from '@/lib/services/rest-timer';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const schedule = jest.mocked(Notifications.scheduleNotificationAsync);
const cancel = jest.mocked(Notifications.cancelScheduledNotificationAsync);

beforeEach(async () => {
  schedule.mockReset().mockResolvedValue('notification');
  cancel.mockReset().mockResolvedValue(undefined);
  await cancelRestNotification();
  cancel.mockClear();
});
afterEach(async () => { await cancelRestNotification(); });

it('does not let an expired queued request cancel the current account notification', async () => {
  const result = deferred<string>();
  const started = deferred<void>();
  schedule.mockImplementationOnce(() => { started.resolve(); return result.promise; });
  const valid = scheduleRestNotification(90);
  await started.promise;
  const expired = scheduleRestNotification(90, undefined, undefined, () => false);
  result.resolve('current-account');
  await expect(valid).resolves.toBe('current-account');
  await expect(expired).resolves.toBeNull();
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});

it('does not start native scheduling if auth expires while cancelling its predecessor', async () => {
  await scheduleRestNotification(90);
  let current = true;
  cancel.mockImplementationOnce(async () => { current = false; });
  await expect(scheduleRestNotification(90, undefined, undefined, () => current)).resolves.toBeNull();
  expect(schedule).toHaveBeenCalledTimes(1);
});

it('cancellation invalidates in-flight and queued schedules without invalidating a later request', async () => {
  const result = deferred<string>();
  const started = deferred<void>();
  schedule.mockImplementationOnce(() => { started.resolve(); return result.promise; });
  const pending = scheduleRestNotification(90);
  await started.promise;
  const queued = scheduleRestNotification(80);
  await cancelRestNotification();
  const next = scheduleRestNotification(70);
  result.resolve('cancelled-in-flight');
  await expect(pending).resolves.toBeNull();
  await expect(queued).resolves.toBeNull();
  await expect(next).resolves.toBe('notification');
  expect(schedule).toHaveBeenCalledTimes(2);
  expect(cancel.mock.calls).toEqual([['cancelled-in-flight']]);
});

it('serializes three simultaneous requests, not just the first two', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  let active = 0;
  let peak = 0;
  let call = 0;
  schedule.mockImplementation(async () => {
    call += 1;
    const index = call;
    active += 1;
    peak = Math.max(peak, active);
    if (index === 1) firstStarted.resolve();
    if (index === 2) secondStarted.resolve();
    const id = await (index === 1 ? first.promise : index === 2 ? second.promise : Promise.resolve('third'));
    active -= 1;
    return id;
  });
  const a = scheduleRestNotification(90);
  await firstStarted.promise;
  const b = scheduleRestNotification(80);
  const c = scheduleRestNotification(70);
  first.resolve('first');
  await secondStarted.promise;
  second.resolve('second');
  await Promise.all([a, b, c]);
  expect(peak).toBe(1);
  expect(cancel.mock.calls).toEqual([['first'], ['second']]);
});

it('a delayed cancellation cannot clear a newer notification ID', async () => {
  schedule.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
  await scheduleRestNotification(90);
  const result = deferred<void>();
  cancel.mockImplementationOnce(() => result.promise);
  const cancelling = cancelRestNotification();
  await scheduleRestNotification(80);
  result.resolve();
  await cancelling;
  cancel.mockClear();
  await cancelRestNotification();
  expect(cancel.mock.calls).toEqual([['new']]);
});

it('targets the returned ID when auth expires during native scheduling', async () => {
  let current = true;
  const result = deferred<string>();
  const started = deferred<void>();
  schedule.mockImplementationOnce(() => { started.resolve(); return result.promise; });
  const pending = scheduleRestNotification(90, 'Squat', 2, () => current);
  await started.promise;
  current = false;
  result.resolve('expired-account-notification');
  await expect(pending).resolves.toBeNull();
  expect(cancel).toHaveBeenCalledWith('expired-account-notification');
  cancel.mockClear();
  await cancelRestNotification();
  expect(cancel).not.toHaveBeenCalled();
});

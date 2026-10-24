import { createWatchMirrorPublisher } from '@/lib/watch-connectivity/mirror-publisher';

describe('Watch mirror publisher', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([1500, 1501])('rejects a capture completed at %ims without running its timeout and recovers', async (elapsed) => {
    jest.useFakeTimers().setSystemTime(10000);
    const monotonicNow = jest.spyOn(performance, 'now').mockReturnValue(2000);
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    let finish!: (value: { frame: string; timestamp: number }) => void;
    publisher.setActive(true);
    const pending = publisher.publish(() => new Promise((resolve) => { finish = resolve; }), send);
    const check = expect(pending).rejects.toThrow('Watch mirror capture timed out');
    expect(jest.getTimerCount()).toBe(1);

    // Simulate a stalled JS thread: elapsed uptime advances, but no timer executes.
    monotonicNow.mockReturnValue(2000 + elapsed);
    jest.setSystemTime(9000); // A wall-clock correction must not extend the deadline.
    finish({ frame: 'overdue', timestamp: 10 });
    await check;
    expect(send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    // An expired capture must neither consume the camera watermark nor keep the lock.
    const fresh = publisher.publish(() => new Promise((resolve) => { finish = resolve; }), send);
    monotonicNow.mockReturnValue(2000 + elapsed + 1499);
    jest.setSystemTime(9500);
    finish({ frame: 'fresh', timestamp: 10 });
    await fresh;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'mirror', frame: 'fresh', timestamp: 10, ts: 9000 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('captures only when enabled and serializes overlapping ticks', async () => {
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    let finish!: (value: { frame: string }) => void;
    const capture = jest.fn(() => new Promise<{ frame: string }>((resolve) => { finish = resolve; }));
    await publisher.publish(capture, send);
    expect(capture).not.toHaveBeenCalled();
    publisher.setActive(true);
    const pending = publisher.publish(capture, send);
    await publisher.publish(capture, send);
    expect(capture).toHaveBeenCalledTimes(1);
    finish({ frame: 'one' });
    await pending;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses capture-start time and recovers after rejected or empty snapshots', async () => {
    jest.useFakeTimers().setSystemTime(10000);
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    publisher.setActive(true);
    await expect(publisher.publish(async () => { throw new Error('camera unavailable'); }, send)).rejects.toThrow('camera unavailable');
    await publisher.publish(async () => null, send);
    const capture = async () => {
      jest.setSystemTime(10500);
      return { frame: 'good' };
    };
    await publisher.publish(capture, send);
    expect(send).toHaveBeenCalledWith({ type: 'mirror', frame: 'good', ts: 10000 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out a stuck capture and allows another frame without publishing the late result', async () => {
    jest.useFakeTimers();
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    let finish!: (value: { frame: string }) => void;
    publisher.setActive(true);
    const pending = publisher.publish(() => new Promise((resolve) => { finish = resolve; }), send);
    const check = expect(pending).rejects.toThrow('Watch mirror capture timed out');
    await jest.advanceTimersByTimeAsync(1500);
    await check;
    await publisher.publish(async () => ({ frame: 'current' }), send);
    finish({ frame: 'late' });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ frame: 'current' }));
  });

  it('does not renew freshness when the camera returns the same frame', async () => {
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    publisher.setActive(true);
    await publisher.publish(async () => ({ frame: 'a', timestamp: 10 }), send);
    await publisher.publish(async () => ({ frame: 'a', timestamp: 10 }), send);
    await publisher.publish(async () => ({ frame: 'older', timestamp: 9 }), send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('preserves the camera watermark across reactivation and accepts only a newer frame', async () => {
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    publisher.setActive(true);
    await publisher.publish(async () => ({ frame: 'initial', timestamp: 10 }), send);

    for (const timestamp of [10, 9]) {
      publisher.setActive(false);
      publisher.setActive(true);
      await publisher.publish(async () => ({ frame: 'stale', timestamp }), send);
      expect(send).toHaveBeenCalledTimes(1);
    }

    await publisher.publish(async () => ({ frame: 'fresh', timestamp: 11 }), send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ frame: 'fresh', timestamp: 11 }));
  });

  it('discards a capture from before Stop even after a restart', async () => {
    const publisher = createWatchMirrorPublisher();
    const send = jest.fn();
    let finish!: (value: { frame: string }) => void;
    const capture = () => new Promise<{ frame: string }>((resolve) => { finish = resolve; });
    publisher.setActive(true);
    const pending = publisher.publish(capture, send);
    publisher.setActive(false);
    publisher.setActive(true);
    finish({ frame: 'old' });
    await pending;
    expect(send).not.toHaveBeenCalled();
    await publisher.publish(async () => ({ frame: 'new' }), send);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mirror', frame: 'new' }));
  });
});

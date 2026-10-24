import { captureWatchMirrorOverlay } from '@/lib/watch-connectivity/mirror-overlay';

describe('Watch mirror overlay capture', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([500, 501])('rejects an SVG callback at %ims without running its timeout and recovers', async (elapsed) => {
    jest.useFakeTimers().setSystemTime(10000);
    const monotonicNow = jest.spyOn(performance, 'now').mockReturnValue(2000);
    let finish!: (data: string) => void;
    const svg = { toDataURL: (callback: (data: string) => void) => { finish = callback; } };
    const result = captureWatchMirrorOverlay(svg, { width: 400, height: 800 }, 320);
    const check = expect(result).rejects.toThrow('Watch overlay capture timed out');
    expect(jest.getTimerCount()).toBe(1);

    // Advance only the monotonic clock: the timeout callback has not executed.
    monotonicNow.mockReturnValue(2000 + elapsed);
    jest.setSystemTime(9000);
    finish('overdue-png');
    await check;
    expect(jest.getTimerCount()).toBe(0);

    const fresh = captureWatchMirrorOverlay(svg, { width: 400, height: 800 }, 320);
    monotonicNow.mockReturnValue(2000 + elapsed + 499);
    finish('fresh-png');
    await expect(fresh).resolves.toBe('fresh-png');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects a missing native callback instead of freezing the publisher', async () => {
    jest.useFakeTimers();
    const result = captureWatchMirrorOverlay({ toDataURL: jest.fn() }, { width: 400, height: 800 }, 320);
    const check = expect(result).rejects.toThrow('Watch overlay capture timed out');
    await jest.advanceTimersByTimeAsync(500);
    await check;
  });

  it('captures the rendered SVG at the camera viewport aspect ratio', async () => {
    const svg = { toDataURL: jest.fn((callback: (data: string) => void) => callback('rendered-png')) };
    await expect(captureWatchMirrorOverlay(svg, { width: 400, height: 800 }, 320)).resolves.toBe('rendered-png');
    expect(svg.toDataURL).toHaveBeenCalledWith(expect.any(Function), { width: 320, height: 640 });
  });
});

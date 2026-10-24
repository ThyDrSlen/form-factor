import { act, renderHook } from '@testing-library/react-native';
import { useBodyTracking } from '@/lib/arkit/ARKitBodyTracker.ios';

const mockNativeStart = jest.fn();
const mockNativeStop = jest.fn();
const mockGetCurrentPose = jest.fn().mockReturnValue(null);
const mockGetCurrentPose2D = jest.fn().mockReturnValue(null);
jest.mock('expo-modules-core', () => ({
  requireNativeModule: () => ({
    isSupported: () => true,
    startTracking: (...args: unknown[]) => mockNativeStart(...args),
    stopTracking: () => mockNativeStop(),
    getCurrentPose: () => mockGetCurrentPose(),
    getCurrentPose2D: () => mockGetCurrentPose2D(),
  }),
}));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  mockNativeStart.mockReset().mockResolvedValue(true);
  mockNativeStop.mockReset();
  mockGetCurrentPose.mockReset().mockReturnValue(null);
  mockGetCurrentPose2D.mockReset().mockReturnValue(null);
});
afterEach(() => jest.useRealTimers());

test('overlapping and already-running starts do not reset the native camera session', async () => {
  const { result, unmount } = renderHook(() => useBodyTracking());
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.startTracking();
    second = result.current.startTracking();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
    await Promise.all([first, second]);
  });
  expect(mockNativeStart).toHaveBeenCalledTimes(1);
  expect(result.current.isTracking).toBe(true);
  await act(async () => {
    const repeated = result.current.startTracking();
    await jest.advanceTimersByTimeAsync(300);
    await repeated;
  });
  expect(mockNativeStart).toHaveBeenCalledTimes(1);
  unmount();
});

test.each(['before native start', 'during native start'] as const)('stop cancels pending startup %s', async timing => {
  let finishNative!: () => void;
  mockNativeStart.mockImplementation(() => new Promise<void>(resolve => { finishNative = resolve; }));
  const { result, unmount } = renderHook(() => useBodyTracking());
  let pending!: Promise<void>;
  act(() => { pending = result.current.startTracking(); });
  if (timing === 'during native start') {
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  }
  act(() => result.current.stopTracking());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
    finishNative?.();
    await pending;
  });
  expect(result.current.isTracking).toBe(false);
  expect(mockNativeStart).toHaveBeenCalledTimes(timing === 'before native start' ? 0 : 1);
  if (timing === 'during native start') expect(mockNativeStop).toHaveBeenCalledTimes(2);
  unmount();
});

test('a new start waits for a cancelled native start to settle, then starts once', async () => {
  let finishNative!: () => void;
  mockNativeStart.mockImplementationOnce(() => new Promise<void>(resolve => { finishNative = resolve; }));
  const { result, unmount } = renderHook(() => useBodyTracking());
  let first!: Promise<void>;
  act(() => { first = result.current.startTracking(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  let second!: Promise<void>;
  act(() => {
    result.current.stopTracking();
    second = result.current.startTracking();
  });
  expect(mockNativeStart).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishNative();
    await first;
    await jest.advanceTimersByTimeAsync(300);
    await second;
  });
  expect(mockNativeStart).toHaveBeenCalledTimes(2);
  expect(result.current.isTracking).toBe(true);
  unmount();
});

test('unmount cancels a queued restart instead of reopening the camera', async () => {
  let finishNative!: () => void;
  mockNativeStart.mockImplementationOnce(() => new Promise<void>(resolve => { finishNative = resolve; }));
  const { result, unmount } = renderHook(() => useBodyTracking());
  let first!: Promise<void>;
  act(() => { first = result.current.startTracking(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  let restart!: Promise<void>;
  act(() => {
    result.current.stopTracking();
    restart = result.current.startTracking();
  });
  unmount();
  await act(async () => {
    finishNative();
    await Promise.all([first, restart]);
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(mockNativeStart).toHaveBeenCalledTimes(1);
  expect(mockNativeStop).toHaveBeenCalledTimes(3);
});

test('a failed start remains observable and does not block a later retry', async () => {
  const failure = new Error('Camera unavailable');
  mockNativeStart.mockRejectedValueOnce(failure);
  const { result, unmount } = renderHook(() => useBodyTracking());
  let failed!: Promise<unknown>;
  act(() => { failed = result.current.startTracking().catch(error => error); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  expect(await failed).toBe(failure);
  expect(result.current.isTracking).toBe(false);
  await act(async () => {
    const retry = result.current.startTracking();
    await jest.advanceTimersByTimeAsync(300);
    await retry;
  });
  expect(mockNativeStart).toHaveBeenCalledTimes(2);
  expect(result.current.isTracking).toBe(true);
  unmount();
});

test('thermal sampling changes take effect mid-session without restarting native tracking', async () => {
  const { result, rerender, unmount } = renderHook(
    ({ activeFps }: { activeFps: number }) => useBodyTracking(60, { activeFps }),
    { initialProps: { activeFps: 60 } },
  );
  await act(async () => {
    const pending = result.current.startTracking();
    await jest.advanceTimersByTimeAsync(300);
    await pending;
  });
  for (const activeFps of [30, 15, 60]) {
    rerender({ activeFps });
    mockGetCurrentPose.mockClear();
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(mockGetCurrentPose.mock.calls.length).toBeGreaterThanOrEqual(activeFps - 1);
    expect(mockGetCurrentPose.mock.calls.length).toBeLessThanOrEqual(activeFps + 3);
    expect(mockNativeStart).toHaveBeenCalledTimes(1);
    expect(mockNativeStop).not.toHaveBeenCalled();
  }
  act(() => result.current.stopTracking());
  mockGetCurrentPose.mockClear();
  rerender({ activeFps: 15 });
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(mockGetCurrentPose).not.toHaveBeenCalled();
  unmount();
});

test('publishes paired poses, ignores duplicate frames, and clears both on tracking loss', async () => {
  const frames: { pose: unknown; pose2D: unknown }[] = [];
  const { result, unmount } = renderHook(() => {
    const tracking = useBodyTracking(30);
    frames.push({ pose: tracking.pose, pose2D: tracking.pose2D });
    return tracking;
  });
  await act(async () => {
    const pending = result.current.startTracking();
    await jest.advanceTimersByTimeAsync(300);
    await pending;
  });
  const pose = { timestamp: 1, isTracking: true, joints: [] };
  const pose2D = {
    timestamp: 1,
    isTracking: true,
    joints: [{ name: 'left_hand_joint', x: 0.2, y: 0.3, isTracked: true }],
  };
  mockGetCurrentPose.mockReturnValue(pose);
  mockGetCurrentPose2D.mockReturnValue(pose2D);
  frames.length = 0;
  await act(async () => { await jest.advanceTimersByTimeAsync(34); });
  expect(frames).toEqual([{ pose, pose2D }]);
  frames.length = 0;
  mockGetCurrentPose2D.mockClear();
  await act(async () => { await jest.advanceTimersByTimeAsync(100); });
  expect(frames).toEqual([]);
  expect(mockGetCurrentPose2D).not.toHaveBeenCalled();

  mockGetCurrentPose.mockReturnValue(null);
  await act(async () => { await jest.advanceTimersByTimeAsync(34); });
  expect(frames).toEqual([{ pose: null, pose2D: null }]);
  expect(result.current.pose).toBeNull();
  expect(result.current.pose2D).toBeNull();
  unmount();
});

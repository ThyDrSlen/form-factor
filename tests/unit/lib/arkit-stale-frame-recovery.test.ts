import { act, renderHook } from '@testing-library/react-native';
import { useBodyTracking } from '@/lib/arkit/ARKitBodyTracker.ios';

const mockGetPose = jest.fn();
const mockGetPose2D = jest.fn();
const mockStart = jest.fn();
jest.mock('expo-modules-core', () => ({
  requireNativeModule: () => ({
    isSupported: () => true,
    startTracking: () => mockStart(),
    stopTracking: jest.fn(),
    getCurrentPose: () => mockGetPose(),
    getCurrentPose2D: () => mockGetPose2D(),
  }),
}));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

const FPS = 20;
const POLL_MS = 1000 / FPS;
const START_DELAY_MS = 300; // Existing AR view mount delay in useBodyTracking.
const pose = { timestamp: 10, isTracking: true, joints: [] };
const pose2D = {
  timestamp: 10,
  isTracking: true,
  joints: [{ name: 'left_hand_joint', x: 0.2, y: 0.3, isTracked: true }],
};

beforeEach(() => {
  jest.useFakeTimers();
  mockStart.mockReset().mockResolvedValue(undefined);
  mockGetPose.mockReset().mockReturnValue(pose);
  mockGetPose2D.mockReset().mockReturnValue(pose2D);
});
afterEach(() => jest.useRealTimers());

async function start(startTracking: () => Promise<void>) {
  await act(async () => {
    const pending = startTracking();
    await jest.advanceTimersByTimeAsync(START_DELAY_MS);
    await pending;
  });
}

async function poll() {
  await act(async () => { await jest.advanceTimersByTimeAsync(POLL_MS); });
}

test.each(['tracking loss', 'stop/start'] as const)(
  'does not resurrect the cached frame after %s; a new sensor frame recovers',
  async boundary => {
    const { result, unmount } = renderHook(() => useBodyTracking(FPS));
    await start(result.current.startTracking);
    await poll();
    expect(result.current.pose).toEqual(pose);
    expect(result.current.pose2D).toEqual(pose2D);

    if (boundary === 'tracking loss') {
      mockGetPose.mockReturnValue(null);
      await poll();
    } else {
      act(() => result.current.stopTracking());
      expect(result.current.isTracking).toBe(false);
    }
    expect(result.current.pose).toBeNull();
    expect(result.current.pose2D).toBeNull();

    mockGetPose.mockReturnValue({ ...pose }); // Same sensor frame, even if reserialized.
    mockGetPose2D.mockClear();
    if (boundary === 'stop/start') await start(result.current.startTracking);
    await poll();
    expect(result.current.pose).toBeNull();
    expect(result.current.pose2D).toBeNull();
    expect(mockGetPose2D).not.toHaveBeenCalled();
    // Session remains active and polling: body visibility is represented by pose.
    expect(result.current.isTracking).toBe(true);

    const freshPose = { ...pose, timestamp: 11 };
    const freshPose2D = { ...pose2D, timestamp: 11 };
    mockGetPose.mockReturnValue(freshPose);
    mockGetPose2D.mockReturnValue(freshPose2D);
    await poll();
    expect(result.current.pose).toEqual(freshPose);
    expect(result.current.pose2D).toEqual(freshPose2D);
    expect(mockStart).toHaveBeenCalledTimes(boundary === 'stop/start' ? 2 : 1);
    unmount();
  },
);

import { act, renderHook } from '@testing-library/react-native';
import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import { usePoseOverlay } from '@/features/form-tracking/hooks/use-pose-overlay';

const elbow: Joint2D = { name: 'left_forearm_joint', x: 0.2, y: 0.4, isTracked: true };

describe('display-only pose overlay continuity', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
  });
  afterEach(() => jest.useRealTimers());

  it('bridges an empty frame, but expires without needing another camera frame', () => {
    const { result, rerender } = renderHook<Joint2D[], { joints: Joint2D[] }>(
      ({ joints }) => usePoseOverlay(joints, true, 'curl'),
      { initialProps: { joints: [elbow] as Joint2D[] } },
    );
    expect(result.current).toEqual([elbow]);
    act(() => jest.advanceTimersByTime(20));
    rerender({ joints: [] });
    expect(result.current).toEqual([elbow]);
    act(() => jest.advanceTimersByTime(131));
    expect(result.current).toEqual([]);
  });

  it('preserves smoothing across a briefly untracked joint without changing sensor data', () => {
    const { result, rerender } = renderHook<Joint2D[], { joints: Joint2D[] }>(
      ({ joints }) => usePoseOverlay(joints, true, 'curl'),
      { initialProps: { joints: [elbow] as Joint2D[] } },
    );
    act(() => jest.advanceTimersByTime(20));
    const lost = { ...elbow, isTracked: false, x: 0 };
    rerender({ joints: [lost] });
    expect(result.current).toEqual([elbow]);
    expect(lost.isTracked).toBe(false);
    act(() => jest.advanceTimersByTime(20));
    const recovered = { ...elbow, x: 0.6 };
    rerender({ joints: [recovered] });
    expect(result.current[0].x).toBeCloseTo(0.42);
    expect(recovered.x).toBe(0.6);
  });

  it('does not extend stale joints through repeated missing or invalid samples', () => {
    const { result, rerender } = renderHook<Joint2D[], { joints: Joint2D[] }>(
      ({ joints }) => usePoseOverlay(joints, true, 'curl'),
      { initialProps: { joints: [elbow] as Joint2D[] } },
    );
    for (let frame = 0; frame < 4; frame += 1) {
      act(() => jest.advanceTimersByTime(40));
      rerender({ joints: [{ ...elbow, x: NaN }] });
    }
    expect(result.current).toEqual([]);
    rerender({ joints: [{ ...elbow, x: 0.8 }] });
    expect(result.current[0].x).toBe(0.8);
  });

  it('resets on stop and exercise change, and cleans up its expiry timer', () => {
    const { result, rerender, unmount } = renderHook<Joint2D[], { joints: Joint2D[]; enabled: boolean; source: string }>(
      ({ joints, enabled, source }) => usePoseOverlay(joints, enabled, source),
      { initialProps: { joints: [elbow] as Joint2D[], enabled: true, source: 'curl' } },
    );
    rerender({ joints: [], enabled: false, source: 'curl' });
    expect(result.current).toEqual([]);
    rerender({ joints: [], enabled: true, source: 'curl' });
    expect(result.current).toEqual([]);
    rerender({ joints: [elbow], enabled: true, source: 'curl' });
    rerender({ joints: [], enabled: true, source: 'squat' });
    expect(result.current).toEqual([]);
    rerender({ joints: [elbow], enabled: true, source: 'squat' });
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds retained geometry when native joint aliases churn', () => {
    const joints = Array.from({ length: 80 }, (_, index) => ({ ...elbow, name: `joint_${index}` }));
    const { result } = renderHook(() => usePoseOverlay(joints, true, 'curl'));
    expect(result.current).toHaveLength(30);
  });

  it('expires duplicate native timestamps instead of treating each poll as a fresh frame', () => {
    const { result, rerender } = renderHook<Joint2D[], { timestamp: number; joints: Joint2D[] }>(
      ({ timestamp, joints }) => usePoseOverlay(joints, true, 'curl', timestamp),
      { initialProps: { timestamp: 10, joints: [elbow] } },
    );
    for (let poll = 0; poll < 5; poll += 1) {
      act(() => jest.advanceTimersByTime(33));
      rerender({ timestamp: 10, joints: [{ ...elbow }] });
    }
    expect(result.current).toEqual([]);
    rerender({ timestamp: 9, joints: [{ ...elbow }] });
    expect(result.current).toEqual([]);
    rerender({ timestamp: 11, joints: [{ ...elbow }] });
    expect(result.current).toEqual([elbow]);
  });

  it('does not repeatedly smooth a duplicate frame or accept an invalid frame timestamp', () => {
    const { result, rerender } = renderHook<Joint2D[], { timestamp: number; joints: Joint2D[] }>(
      ({ timestamp, joints }) => usePoseOverlay(joints, true, 'curl', timestamp),
      { initialProps: { timestamp: 10, joints: [elbow] } },
    );
    act(() => jest.advanceTimersByTime(33));
    rerender({ timestamp: 11, joints: [{ ...elbow, x: 0.4 }] });
    const filtered = result.current[0].x;
    act(() => jest.advanceTimersByTime(33));
    rerender({ timestamp: 11, joints: [{ ...elbow, x: 0.4 }] });
    expect(result.current[0].x).toBe(filtered);
    rerender({ timestamp: NaN, joints: [{ ...elbow, x: 0.8 }] });
    expect(result.current[0].x).toBe(filtered);
  });

  it('accepts a reset native clock only after source change or stop', () => {
    const { result, rerender } = renderHook<Joint2D[], { source: string; enabled: boolean; timestamp: number; joints: Joint2D[] }>(
      ({ source, enabled, timestamp, joints }) => usePoseOverlay(joints, enabled, source, timestamp),
      { initialProps: { source: 'curl', enabled: true, timestamp: 10, joints: [elbow] } },
    );
    rerender({ source: 'squat', enabled: true, timestamp: 1, joints: [{ ...elbow, x: 0.8 }] });
    expect(result.current[0].x).toBe(0.8);
    rerender({ source: 'squat', enabled: false, timestamp: 1, joints: [{ ...elbow, x: 0.8 }] });
    expect(result.current).toEqual([]);
    rerender({ source: 'squat', enabled: true, timestamp: 0, joints: [{ ...elbow, x: 0.3 }] });
    expect(result.current[0].x).toBe(0.3);
  });

  it('hides curl knees and ankles, retains hips and torso, and leaves raw joints untouched', () => {
    const retained = ['left_forearm_joint', 'left_hand_joint', 'right_hand_joint', 'hips_joint', 'spine_4_joint', 'left_upLeg_joint', 'right_upLeg_joint'];
    const ignored = ['left_leg_joint', 'RIGHT_LEG_JOINT', 'left_foot_joint', 'right_foot_joint'];
    const joints = [...retained, ...ignored].map(name => ({ ...elbow, name }));
    const { result, rerender } = renderHook<Joint2D[], { source: string }>(
      ({ source }) => usePoseOverlay(joints, true, source, 10),
      { initialProps: { source: 'squat' } },
    );
    expect(result.current).toEqual(joints);
    rerender({ source: 'dumbbell_curl' });
    expect(result.current.map(joint => joint.name)).toEqual(retained);
    expect(joints.map(joint => joint.name)).toEqual([...retained, ...ignored]);
    expect(joints.every(joint => joint.isTracked)).toBe(true);
    rerender({ source: 'deadlift' });
    expect(result.current).toEqual(joints);
  });
});

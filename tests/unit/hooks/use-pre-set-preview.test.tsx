const mockCheckPreSetStance = jest.fn();

jest.mock('@/lib/services/pre-set-preview', () => ({
  checkPreSetStance: (...args: unknown[]) => mockCheckPreSetStance(...args),
}));

jest.mock('@/lib/arkit/ARKitBodyTracker', () => ({}));

import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { FrameSnapshot, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { usePreSetPreview } from '@/hooks/use-pre-set-preview';

const snapshot: FrameSnapshot = { frame: 'data:image/jpeg;base64,AAAA' };
const angles: JointAngles = {
  leftKnee: 170,
  rightKnee: 170,
  leftElbow: 175,
  rightElbow: 175,
  leftHip: 170,
  rightHip: 170,
  leftShoulder: 90,
  rightShoulder: 90,
};

describe('usePreSetPreview', () => {
  beforeEach(() => {
    mockCheckPreSetStance.mockReset();
  });

  it('starts in an idle state', () => {
    const { result } = renderHook(() => usePreSetPreview());
    expect(result.current.isChecking).toBe(false);
    expect(result.current.verdict).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets isChecking while the request is pending and lands a verdict', async () => {
    let resolver: (value: unknown) => void = () => {};
    mockCheckPreSetStance.mockImplementation(
      () => new Promise((resolve) => { resolver = resolve; })
    );

    const { result } = renderHook(() => usePreSetPreview());

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.check(snapshot, 'deadlift', angles);
    });

    await waitFor(() => expect(result.current.isChecking).toBe(true));

    act(() => {
      resolver({ verdict: '✓ Good', isFormGood: true, provider: 'openai' });
    });

    await act(async () => {
      await pending;
    });

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.verdict?.isFormGood).toBe(true);
    expect(result.current.verdict?.verdict).toContain('Good');
    expect(result.current.error).toBeNull();
  });

  it('captures thrown errors and surfaces them via state', async () => {
    mockCheckPreSetStance.mockRejectedValueOnce(new Error('coach offline'));

    const { result } = renderHook(() => usePreSetPreview());

    await act(async () => {
      await result.current.check(snapshot, 'pullup', angles);
    });

    expect(result.current.isChecking).toBe(false);
    expect(result.current.verdict).toBeNull();
    expect(result.current.error?.message).toBe('coach offline');
  });

  it('single-flights overlapping check() calls', async () => {
    let resolver: (value: unknown) => void = () => {};
    mockCheckPreSetStance.mockImplementation(
      () => new Promise((resolve) => { resolver = resolve; })
    );

    const { result } = renderHook(() => usePreSetPreview());

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;

    act(() => {
      first = result.current.check(snapshot, 'squat', angles);
    });

    act(() => {
      second = result.current.check(snapshot, 'squat', angles);
    });

    // Second call returns null synchronously (ignored due to in-flight guard).
    await expect(second).resolves.toBeNull();
    expect(mockCheckPreSetStance).toHaveBeenCalledTimes(1);

    act(() => {
      resolver({ verdict: '✓ Good', isFormGood: true, provider: 'openai' });
    });

    await act(async () => {
      await first;
    });
  });

  it('reset() clears verdict, error, and the in-flight guard', async () => {
    mockCheckPreSetStance.mockResolvedValueOnce({
      verdict: '⚠ bend knees',
      isFormGood: false,
      provider: 'openai',
    });

    const { result } = renderHook(() => usePreSetPreview());

    await act(async () => {
      await result.current.check(snapshot, 'deadlift', angles);
    });

    expect(result.current.verdict?.isFormGood).toBe(false);

    act(() => {
      result.current.reset();
    });

    expect(result.current.verdict).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isChecking).toBe(false);

    // After reset, a new check should fire.
    mockCheckPreSetStance.mockResolvedValueOnce({
      verdict: '✓ Good',
      isFormGood: true,
      provider: 'openai',
    });

    await act(async () => {
      await result.current.check(snapshot, 'deadlift', angles);
    });

    expect(result.current.verdict?.isFormGood).toBe(true);
    expect(mockCheckPreSetStance).toHaveBeenCalledTimes(2);
  });
});

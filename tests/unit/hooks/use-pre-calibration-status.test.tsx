import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PRE_CALIBRATION_CONSTANTS,
  usePreCalibrationStatus,
} from '@/hooks/use-pre-calibration-status';

describe('usePreCalibrationStatus', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts in pending with shouldShow=true when storage is empty', async () => {
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(true);
    });
    expect(result.current.status.status).toBe('pending');
    expect(result.current.status.framesObserved).toBe(0);
  });

  it('aggregates per-frame confidence into a running mean', async () => {
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(true);
    });
    act(() => {
      result.current.recordFrame(0.8);
      result.current.recordFrame(0.6);
    });
    expect(result.current.status.framesObserved).toBe(2);
    expect(result.current.status.confidence).toBeCloseTo(0.7, 2);
  });

  it('auto-marks success once confidence + frame thresholds are met', async () => {
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(true);
    });
    await act(async () => {
      for (let i = 0; i < PRE_CALIBRATION_CONSTANTS.REQUIRED_FRAMES; i += 1) {
        result.current.recordFrame(0.9);
      }
    });
    await waitFor(() => {
      expect(result.current.status.status).toBe('success');
    });
    const stored = await AsyncStorage.getItem(PRE_CALIBRATION_CONSTANTS.STORAGE_KEY);
    expect(stored).toBe('1');
  });

  it('suppresses shouldShow after the configured success count', async () => {
    await AsyncStorage.setItem(
      PRE_CALIBRATION_CONSTANTS.STORAGE_KEY,
      String(PRE_CALIBRATION_CONSTANTS.SUPPRESS_AFTER_SUCCESS_COUNT)
    );
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(false);
    });
  });

  it('markFailed transitions status to failed', async () => {
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(true);
    });
    act(() => {
      result.current.markFailed();
    });
    expect(result.current.status.status).toBe('failed');
  });

  it('reset() clears frame counters but preserves shouldShow', async () => {
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(true);
    });
    act(() => {
      result.current.recordFrame(0.5);
      result.current.recordFrame(0.5);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status.framesObserved).toBe(0);
    expect(result.current.status.confidence).toBe(0);
    expect(result.current.status.shouldShow).toBe(true);
  });

  it('clamps out-of-range confidence inputs', async () => {
    const { result } = renderHook(() => usePreCalibrationStatus());
    await waitFor(() => {
      expect(result.current.status.shouldShow).toBe(true);
    });
    act(() => {
      result.current.recordFrame(2);
      result.current.recordFrame(-1);
    });
    expect(result.current.status.confidence).toBeCloseTo(0.5, 2);
  });
});

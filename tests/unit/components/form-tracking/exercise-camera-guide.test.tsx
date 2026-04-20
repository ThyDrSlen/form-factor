/**
 * Unit tests for ExerciseCameraGuide card + use-exercise-camera-guide hook.
 *
 * Covers:
 *   - Renders a complete card for every exercise with a guide (14 total)
 *   - Returns null for an unknown exercise key
 *   - Dismiss round-trips through AsyncStorage (per-exercise)
 *   - "Don't show again" suppresses globally
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import ExerciseCameraGuide from '@/components/form-tracking/ExerciseCameraGuide';
import { useExerciseCameraGuide } from '@/hooks/use-exercise-camera-guide';
import { renderHook } from '@testing-library/react-native';
import {
  getAllPlacementGuides,
  getPlacementGuide,
} from '@/lib/services/camera-placement-guide';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ---------------------------------------------------------------------------
// Component — render states across all exercises
// ---------------------------------------------------------------------------

describe('ExerciseCameraGuide — render', () => {
  it('renders a card with summary + pitfalls for every exercise', async () => {
    for (const guide of getAllPlacementGuides()) {
      const override = getPlacementGuide(guide.key);
      const { queryByTestId, getByText, unmount } = render(
        <ExerciseCameraGuide exerciseKey={guide.key} guideOverride={override} />
      );

      await waitFor(() => {
        expect(queryByTestId('exercise-camera-guide')).toBeTruthy();
      });

      expect(getByText(guide.displayName)).toBeTruthy();
      expect(getByText(guide.summary)).toBeTruthy();
      // First pitfall should appear
      expect(getByText(guide.commonPitfalls[0])).toBeTruthy();

      unmount();
    }
  });

  it('renders nothing when the exercise key has no guide', async () => {
    const { queryByTestId } = render(
      <ExerciseCameraGuide exerciseKey="bogus" guideOverride={null} />
    );
    expect(queryByTestId('exercise-camera-guide')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hook — dismiss preference round-trip
// ---------------------------------------------------------------------------

describe('useExerciseCameraGuide — dismiss round-trip', () => {
  it('starts visible, becomes hidden after dismiss(), persists across mounts for the same key', async () => {
    const { result } = renderHook(() => useExerciseCameraGuide('pullup'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.visible).toBe(true);
    expect(result.current.guide?.key).toBe('pullup');

    await act(async () => {
      await result.current.dismiss();
    });
    expect(result.current.visible).toBe(false);

    // New mount reads the persisted dismiss
    const second = renderHook(() => useExerciseCameraGuide('pullup'));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.visible).toBe(false);
  });

  it('per-exercise dismiss does not bleed across exercises', async () => {
    const pullup = renderHook(() => useExerciseCameraGuide('pullup'));
    await waitFor(() => expect(pullup.result.current.ready).toBe(true));
    await act(async () => {
      await pullup.result.current.dismiss();
    });
    expect(pullup.result.current.visible).toBe(false);

    const squat = renderHook(() => useExerciseCameraGuide('squat'));
    await waitFor(() => expect(squat.result.current.ready).toBe(true));
    expect(squat.result.current.visible).toBe(true);
  });

  it('reset() clears the per-exercise dismiss and guide becomes visible again', async () => {
    const { result } = renderHook(() => useExerciseCameraGuide('squat'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.dismiss();
    });
    expect(result.current.visible).toBe(false);

    await act(async () => {
      await result.current.reset();
    });
    expect(result.current.visible).toBe(true);
  });

  it('dismissAndRemember() suppresses guides globally', async () => {
    const first = renderHook(() => useExerciseCameraGuide('pushup'));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => {
      await first.result.current.dismissAndRemember();
    });
    expect(first.result.current.visible).toBe(false);

    // A different exercise now also gets suppressed
    const second = renderHook(() => useExerciseCameraGuide('deadlift'));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.visible).toBe(false);

    // Clearing the global opt-out restores visibility for the non-dismissed one
    await act(async () => {
      await second.result.current.clearGlobalSuppress();
    });
    expect(second.result.current.visible).toBe(true);
  });

  it('returns null guide for unknown keys', async () => {
    const { result } = renderHook(() => useExerciseCameraGuide('mystery'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.guide).toBeNull();
    expect(result.current.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component dismiss wiring
// ---------------------------------------------------------------------------

describe('ExerciseCameraGuide — dismiss button', () => {
  it('calls onDismiss when the close button is tapped and override is provided', async () => {
    const onDismiss = jest.fn();
    const override = getPlacementGuide('pullup');
    const { getByTestId } = render(
      <ExerciseCameraGuide
        exerciseKey="pullup"
        guideOverride={override}
        onDismiss={onDismiss}
      />
    );

    const btn = getByTestId('exercise-camera-guide-dismiss');
    await act(async () => {
      fireEvent.press(btn);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

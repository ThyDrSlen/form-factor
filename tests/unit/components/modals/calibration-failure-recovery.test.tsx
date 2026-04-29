/**
 * Wave 30 C2 — CalibrationFailureRecoveryModal render coverage.
 *
 * The modal (app/(modals)/calibration-failure-recovery.tsx) is rendered by
 * the ARKit scan tab when `use-calibration-failure-handler` classifies a
 * stalled calibration. This spec asserts:
 *
 *   - Each known failure reason (`low_stability`, `insufficient_samples`,
 *     `excessive_drift`, `timeout`) renders its reason-specific copy so
 *     Pack A's remediation rewording does not silently regress the
 *     modal's intent.
 *   - An unknown reason (`low_confidence`, which is NOT in the source
 *     map) falls back to the "Issue detected" default without crashing.
 *     This flexibility is intentional: Pack A (#556) is expanding the
 *     reason set, and this spec should survive that expansion.
 *   - Sparse / mixed metrics payload (zero elapsed, null sample count,
 *     undefined drift) do not throw during formatter execution.
 *   - The three CTAs route through expo-router's `replace` (primary +
 *     secondary) and `back` (close button).
 *
 * Pack-A safety: we assert via accessibility labels rather than exact
 * body-copy text because finding A14 is rewording the remediation
 * strings — copy assertions would be brittle.
 */

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockSearchParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    back: mockBack,
  }),
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: {
    Warning: 'warning',
    Success: 'success',
    Error: 'error',
  },
}));

import CalibrationFailureRecoveryModal from '@/app/(modals)/calibration-failure-recovery';

function renderWith(
  params: Record<string, string | string[] | undefined> = {},
) {
  mockSearchParams = params;
  return render(<CalibrationFailureRecoveryModal />);
}

describe('CalibrationFailureRecoveryModal — render (wave-30 C2)', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockBack.mockClear();
    mockSearchParams = {};
  });

  // Reason-specific labels map — kept in sync with REASON_LABELS in the
  // source. Pack A may rename / expand these; the test asserts each
  // known reason renders a visible tag without asserting exact text
  // beyond what the source currently ships.
  const knownReasons: Array<{ reason: string; label: string }> = [
    { reason: 'low_stability', label: 'Low stability' },
    { reason: 'insufficient_samples', label: 'Not in frame' },
    { reason: 'excessive_drift', label: 'Drifted out of frame' },
    { reason: 'timeout', label: 'Timed out' },
  ];

  test.each(knownReasons)(
    'renders reason tag for reason=%s',
    ({ reason, label }) => {
      const { getByText, getByLabelText } = renderWith({
        reason,
        title: `${reason} title`,
      });

      // Reason-specific label is rendered inside the tag pill.
      expect(getByText(label)).toBeTruthy();
      // Primary + secondary CTAs are present — identifiable by a11y
      // label so Pack A's copy rewording does not break this test.
      expect(getByLabelText('Retry calibration')).toBeTruthy();
      expect(getByLabelText('Open camera placement guide')).toBeTruthy();
      // Close control is always present.
      expect(getByLabelText('Close recovery modal')).toBeTruthy();
    },
  );

  test('falls back to default reason label when reason is unknown (e.g. mystery_reason)', () => {
    // Wave-34 A14 expanded the REASON_LABELS map to include `low_confidence`,
    // so this test picks a genuinely-unknown reason key. The modal should
    // degrade gracefully to the generic "Issue detected" label rather
    // than crashing or rendering an empty tag.
    const { getByText, getByLabelText } = renderWith({
      reason: 'mystery_reason',
      title: 'Something went sideways',
    });

    expect(getByText('Issue detected')).toBeTruthy();
    // CTAs still render so the user has a path forward.
    expect(getByLabelText('Retry calibration')).toBeTruthy();
    expect(getByLabelText('Open camera placement guide')).toBeTruthy();
  });

  test('handles sparse / mixed metrics payload without crashing the formatter', () => {
    // elapsedMs=0, sampleCount=null, avgStability=0.42, driftDeg=undefined
    // exercises the boundary where Number() would coerce falsy values
    // incorrectly if the formatter dropped its null-guard.
    const { getByText } = renderWith({
      reason: 'low_stability',
      elapsedMs: '0',
      // sampleCount intentionally omitted (equivalent to null) so
      // Number(undefined) would produce NaN without the guard.
      avgStability: '0.42',
      // driftDeg intentionally omitted.
    });

    // avgStability=0.42 is rendered as "0.42" inside the metrics card.
    expect(getByText('0.42')).toBeTruthy();
    // The "0.0 s" elapsed copy is rendered (elapsedMs=0 / 1000 → 0.0s).
    expect(getByText('0.0 s')).toBeTruthy();
  });

  test('tap Retry routes router.replace to scan-arkit with retryCalibration payload', () => {
    const { getByLabelText } = renderWith({ reason: 'timeout' });

    fireEvent.press(getByLabelText('Retry calibration'));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const call = mockReplace.mock.calls[0][0] as {
      pathname: string;
      params: { retryCalibration: string };
    };
    expect(call.pathname).toBe('/(tabs)/scan-arkit');
    expect(call.params).toEqual({ retryCalibration: '1' });
  });

  test('tap Open camera guide routes router.replace with showCameraGuide payload', () => {
    // NOTE: the source currently calls `router.replace` (not `push`) for
    // the camera-guide CTA. Asserting against actual source behaviour.
    const { getByLabelText } = renderWith({ reason: 'excessive_drift' });

    fireEvent.press(getByLabelText('Open camera placement guide'));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const call = mockReplace.mock.calls[0][0] as {
      pathname: string;
      params: { showCameraGuide: string };
    };
    expect(call.pathname).toBe('/(tabs)/scan-arkit');
    expect(call.params).toEqual({ showCameraGuide: '1' });
  });

  test('tap Close button pops the router (router.back)', () => {
    const { getByLabelText } = renderWith({ reason: 'timeout' });

    fireEvent.press(getByLabelText('Close recovery modal'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('tertiary Try-different-exercise CTA only renders when suggestedExercise is provided', () => {
    const withoutSuggestion = renderWith({ reason: 'low_stability' });
    expect(withoutSuggestion.queryByLabelText('Try a different exercise')).toBeNull();

    withoutSuggestion.unmount();

    const { getByLabelText } = renderWith({
      reason: 'low_stability',
      suggestedExercise: 'goblet_squat',
    });
    expect(getByLabelText('Try a different exercise')).toBeTruthy();
  });
});

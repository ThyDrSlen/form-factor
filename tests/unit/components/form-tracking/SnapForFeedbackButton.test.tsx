import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CameraView } from 'expo-camera';

import { SnapForFeedbackButton } from '@/components/form-tracking/SnapForFeedbackButton';

type MinimalCamera = Pick<CameraView, 'takePictureAsync'>;

function makeCameraRef(mockTake: jest.Mock): {
  ref: React.RefObject<CameraView | null>;
  camera: MinimalCamera;
} {
  const camera = { takePictureAsync: mockTake } as unknown as CameraView;
  return {
    ref: { current: camera } as React.RefObject<CameraView | null>,
    camera,
  };
}

describe('SnapForFeedbackButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering + a11y', () => {
    it('renders with the canonical label, role, and hint referencing exercise + phase', () => {
      const mockTake = jest.fn();
      const { ref } = makeCameraRef(mockTake);
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          exercise="squat"
          phase="bottom"
        />,
      );

      const btn = getByTestId('snap-for-feedback-button');
      expect(btn.props.accessibilityRole).toBe('button');
      expect(btn.props.accessibilityLabel).toBe('Snap for coach feedback');
      expect(btn.props.accessibilityHint).toContain('squat');
      expect(btn.props.accessibilityHint).toContain('bottom');
    });

    it('falls back to generic copy when exercise/phase are empty', () => {
      const { ref } = makeCameraRef(jest.fn());
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          exercise=""
          phase=""
        />,
      );

      const btn = getByTestId('snap-for-feedback-button');
      expect(btn.props.accessibilityHint).toContain('lift');
      expect(btn.props.accessibilityHint).toContain('current');
    });

    it('respects a custom testID', () => {
      const { ref } = makeCameraRef(jest.fn());
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          exercise="pullup"
          phase="top"
          testID="custom-snap"
        />,
      );
      expect(getByTestId('custom-snap')).toBeTruthy();
    });

    it('renders disabled when the ref is not mounted', () => {
      const emptyRef: React.RefObject<CameraView | null> = { current: null };
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={emptyRef}
          onSnap={jest.fn()}
          exercise="squat"
          phase="top"
        />,
      );
      const btn = getByTestId('snap-for-feedback-button');
      expect(btn.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('renders disabled when the disabled prop is true', () => {
      const { ref } = makeCameraRef(jest.fn());
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          exercise="squat"
          phase="top"
          disabled
        />,
      );
      const btn = getByTestId('snap-for-feedback-button');
      expect(btn.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });
  });

  describe('capture behavior', () => {
    it('calls takePictureAsync and forwards the URI to onSnap', async () => {
      const mockTake = jest
        .fn()
        .mockResolvedValue({ uri: 'file:///tmp/snap.jpg' });
      const onSnap = jest.fn();
      const { ref } = makeCameraRef(mockTake);
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={onSnap}
          exercise="squat"
          phase="bottom"
        />,
      );

      fireEvent.press(getByTestId('snap-for-feedback-button'));
      await waitFor(() => expect(onSnap).toHaveBeenCalledWith('file:///tmp/snap.jpg'));
      expect(mockTake).toHaveBeenCalledWith(
        expect.objectContaining({ base64: false, skipProcessing: false }),
      );
    });

    it('honors the quality prop', async () => {
      const mockTake = jest.fn().mockResolvedValue({ uri: 'file:///x.jpg' });
      const { ref } = makeCameraRef(mockTake);
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          exercise="squat"
          phase="top"
          quality={0.9}
        />,
      );

      fireEvent.press(getByTestId('snap-for-feedback-button'));
      await waitFor(() => expect(mockTake).toHaveBeenCalled());
      expect(mockTake).toHaveBeenCalledWith(
        expect.objectContaining({ quality: 0.9 }),
      );
    });

    it('does not call onSnap when takePictureAsync returns no uri', async () => {
      const mockTake = jest.fn().mockResolvedValue({});
      const onSnap = jest.fn();
      const { ref } = makeCameraRef(mockTake);
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={onSnap}
          exercise="squat"
          phase="top"
        />,
      );

      fireEvent.press(getByTestId('snap-for-feedback-button'));
      await waitFor(() => expect(mockTake).toHaveBeenCalled());
      expect(onSnap).not.toHaveBeenCalled();
    });

    it('invokes onError when takePictureAsync throws', async () => {
      const err = new Error('boom');
      const mockTake = jest.fn().mockRejectedValue(err);
      const onError = jest.fn();
      const { ref } = makeCameraRef(mockTake);
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          onError={onError}
          exercise="squat"
          phase="top"
        />,
      );

      fireEvent.press(getByTestId('snap-for-feedback-button'));
      await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
    });

    it('swallows errors silently when no onError is supplied', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockTake = jest.fn().mockRejectedValue(new Error('boom'));
      const { ref } = makeCameraRef(mockTake);
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={ref}
          onSnap={jest.fn()}
          exercise="squat"
          phase="top"
        />,
      );

      fireEvent.press(getByTestId('snap-for-feedback-button'));
      await waitFor(() => expect(mockTake).toHaveBeenCalled());
      warn.mockRestore();
    });

    it('does nothing when pressed while the ref is not mounted', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const onSnap = jest.fn();
      const emptyRef: React.RefObject<CameraView | null> = { current: null };
      const { getByTestId } = render(
        <SnapForFeedbackButton
          cameraRef={emptyRef}
          onSnap={onSnap}
          exercise="squat"
          phase="top"
        />,
      );

      fireEvent.press(getByTestId('snap-for-feedback-button'));
      // No takePictureAsync to call; onSnap must not fire.
      expect(onSnap).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});

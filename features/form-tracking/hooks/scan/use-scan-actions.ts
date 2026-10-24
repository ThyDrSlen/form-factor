import { useEffect, useCallback } from 'react';
import { Platform, ToastAndroid, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
import { WATCH_MIRROR_MAX_WIDTH, WATCH_MIRROR_AR_QUALITY } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanRecordingCtx } from '@/features/form-tracking/hooks/scan/use-scan-recording';

export function useScanActions(ctx: ScanRecordingCtx) {
  const {
    activeWorkoutDef, cleanupLocalRecording, detectionMode, gestureHoldStartRef,
    gestureRecordingEnabled, isFinalizingRecording, isRecording, isTracking, jointAngles,
    lastGestureTriggerRef, lastUploadPayloadRef, partialWarningVisibleRef,
    pendingRecordAfterTrackingRef, pose, preSetPreview, recordPreview, saveRecordingToCameraRoll,
    savingRecording, setIsPreviewVisible, setPartialTrackingBannerDismissedUntilMs,
    setPreSetPreviewVisible, setPreviewError, setRecordPreview, setRecordingStartStatus,
    setSavingRecording, setShowCameraGuide, setShowPartialTrackingBadge, setUploadRetryPayload,
    showToast, smoothedPose2DRef, startRecordingVideo, startTracking, uploadRecordedVideo,
    uploading,
  } = ctx;

  useEffect(() => {
    if (!gestureRecordingEnabled || isRecording || isFinalizingRecording) {
      gestureHoldStartRef.current = null;
      return;
    }

    // Read joints from the ref (kept fresh each frame) rather than from the
    // smoothedPose2DJoints state, which now only flips on partial-tracking
    // badge visibility change. Re-key the effect on `pose` so hand-hold
    // detection still samples every frame.
    const joints = smoothedPose2DRef.current;
    if (!joints || joints.length === 0) {
      gestureHoldStartRef.current = null;
      return;
    }

    const findJoint = (needle: string) =>
      joints.find(
        (joint) => joint.isTracked && joint.name.toLowerCase().includes(needle)
      );

    const leftHand = findJoint('left_hand');
    const rightHand = findJoint('right_hand');
    const leftShoulder = findJoint('left_shoulder');
    const rightShoulder = findJoint('right_shoulder');

    const bothHandsAboveShoulders =
      leftHand &&
      rightHand &&
      leftShoulder &&
      rightShoulder &&
      leftHand.y < leftShoulder.y - 0.05 &&
      rightHand.y < rightShoulder.y - 0.05;

    if (bothHandsAboveShoulders) {
      const now = Date.now();
      if (!gestureHoldStartRef.current) {
        gestureHoldStartRef.current = now;
      } else if (
        now - gestureHoldStartRef.current >= 500 &&
        now - lastGestureTriggerRef.current > 2000
      ) {
        lastGestureTriggerRef.current = now;
        gestureHoldStartRef.current = null;
        startRecordingVideo();
        const message = 'Gesture recording started';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } else {
      gestureHoldStartRef.current = null;
    }
  }, [gestureRecordingEnabled, pose, isRecording, isFinalizingRecording, startRecordingVideo, smoothedPose2DRef, gestureHoldStartRef, lastGestureTriggerRef]);

  const handlePreSetPreviewCheck = useCallback(async () => {
    if (!isTracking) {
      showToast(detectionMode === 'dumbbell_curl'
        ? 'Starting camera — keep your arms and hips in frame, then check your stance.'
        : 'Starting camera — step fully into frame, then run stance check again.', {
        type: 'info',
      });
      await startTracking();
      return;
    }

    if (!jointAngles) {
      showToast(detectionMode === 'dumbbell_curl'
        ? 'Keep your shoulders, elbows, hands, and hips in frame. Knees are not needed for curls.'
        : 'Step fully into frame so we can see your joints first.', {
        type: 'info',
      });
      return;
    }

    preSetPreview.reset();
    setPreSetPreviewVisible(true);
    const snapshot = await BodyTracker.getCurrentFrameSnapshot({
      maxWidth: WATCH_MIRROR_MAX_WIDTH,
      quality: WATCH_MIRROR_AR_QUALITY,
    });
    if (!snapshot) {
      setPreSetPreviewVisible(false);
      showToast('Could not grab a camera frame yet — keep the phone steady and try again.', {
        type: 'error',
      });
      return;
    }
    await preSetPreview.check(snapshot, activeWorkoutDef.displayName, jointAngles);
  }, [activeWorkoutDef.displayName, detectionMode, isTracking, jointAngles, preSetPreview, setPreSetPreviewVisible, showToast, startTracking]);

  const handleStartSetFromPreview = useCallback(async () => {
    setPreSetPreviewVisible(false);
    preSetPreview.reset();
    if (!isTracking) {
      pendingRecordAfterTrackingRef.current = true;
      setRecordingStartStatus('starting-camera');
      showToast('Camera starting — recording will begin when your skeleton appears.', {
        type: 'info',
      });
      await startTracking();
      return;
    }
    if (!jointAngles) {
      pendingRecordAfterTrackingRef.current = true;
      setRecordingStartStatus('waiting-for-skeleton');
      showToast(detectionMode === 'dumbbell_curl'
        ? 'Keep your arms and hips in frame — recording will begin when they are tracked.'
        : 'Step fully into frame — recording will begin as soon as we see your skeleton.', {
        type: 'info',
      });
      return;
    }
    await startRecordingVideo();
  }, [detectionMode, isTracking, jointAngles, pendingRecordAfterTrackingRef, preSetPreview, setPreSetPreviewVisible, setRecordingStartStatus, showToast, startRecordingVideo, startTracking]);

  const handleCheckLighting = useCallback(() => {
    setShowCameraGuide(true);
    Alert.alert(
      'Improve tracking signal',
      detectionMode === 'dumbbell_curl'
        ? 'Keep your shoulders, elbows, hands, and hips in frame. Knees and feet can stay outside the frame. Face the strongest light source.'
        : 'Put the phone 6–8 feet back at hip height, keep your full body in frame, and face the strongest light source before the next set.',
    );
  }, [detectionMode, setShowCameraGuide]);

  const handleDismissPartialTrackingBanner = useCallback(() => {
    setPartialTrackingBannerDismissedUntilMs(Date.now() + 5000);
    partialWarningVisibleRef.current = false;
    setShowPartialTrackingBadge(false);
  }, [partialWarningVisibleRef, setPartialTrackingBannerDismissedUntilMs, setShowPartialTrackingBadge]);

  const handleDiscardRecording = useCallback(async () => {
    if (uploading || savingRecording) return;
    if (!recordPreview) {
      setIsPreviewVisible(false);
      return;
    }
    await cleanupLocalRecording(recordPreview.uri);
    setUploadRetryPayload(null);
    lastUploadPayloadRef.current = null;
    setRecordPreview(null);
    setPreviewError(null);
    setIsPreviewVisible(false);
  }, [uploading, savingRecording, recordPreview, cleanupLocalRecording, setUploadRetryPayload, lastUploadPayloadRef, setRecordPreview, setPreviewError, setIsPreviewVisible]);

  const confirmDiscardRecording = useCallback(() => {
    if (uploading || savingRecording) return;
    Alert.alert('Delete local recording?', 'This removes the video from this device without publishing it.', [
      { text: 'Keep reviewing', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void handleDiscardRecording(); } },
    ]);
  }, [handleDiscardRecording, uploading, savingRecording]);

  const handleReacquireSubject = useCallback(() => {
    BodyTracker.resetSubjectLock();
    const message = 'Subject lock reset';
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

    const handleSaveOnlyRecording = useCallback(async () => {
      if (!recordPreview || uploading || savingRecording) return;
      setPreviewError(null);
      let saved = recordPreview.savedToLibrary;
      if (!saved) {
        setSavingRecording(true);
        saved = await saveRecordingToCameraRoll(recordPreview.uri);
        setSavingRecording(false);
        if (saved) {
          setRecordPreview((prev) => (prev ? { ...prev, savedToLibrary: true } : prev));
        }
      }
      if (!saved) return;
      const message = 'Saved to Photos.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.SHORT);
      } else {
        Alert.alert('Saved', message);
      }
      await cleanupLocalRecording(recordPreview.uri);
      setUploadRetryPayload(null);
      lastUploadPayloadRef.current = null;
      setRecordPreview(null);
      setPreviewError(null);
      setIsPreviewVisible(false);
    }, [recordPreview, uploading, savingRecording, setPreviewError, cleanupLocalRecording, setUploadRetryPayload, lastUploadPayloadRef, setRecordPreview, setIsPreviewVisible, setSavingRecording, saveRecordingToCameraRoll]);

    const handlePublishRecording = useCallback(async () => {
      if (!recordPreview || uploading || savingRecording) return;
      setPreviewError(null);
      let saved = recordPreview.savedToLibrary;
      if (!saved) {
        setSavingRecording(true);
        saved = await saveRecordingToCameraRoll(recordPreview.uri);
        setSavingRecording(false);
        if (saved) {
          setRecordPreview((prev) => (prev ? { ...prev, savedToLibrary: true } : prev));
        }
      }
      if (!saved) return;

      const uploaded = await uploadRecordedVideo({
        uri: recordPreview.uri,
        exercise: recordPreview.exercise,
        metrics: recordPreview.metrics,
      });
      if (uploaded) {
        const message = 'Published to your feed and saved to Photos.';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Alert.alert('Published', message);
        }
        await cleanupLocalRecording(recordPreview.uri);
        setUploadRetryPayload(null);
        lastUploadPayloadRef.current = null;
        setRecordPreview(null);
        setPreviewError(null);
        setIsPreviewVisible(false);
      }
    }, [recordPreview, uploading, savingRecording, setPreviewError, uploadRecordedVideo, setSavingRecording, saveRecordingToCameraRoll, setRecordPreview, cleanupLocalRecording, setUploadRetryPayload, lastUploadPayloadRef, setIsPreviewVisible]);

  return {
    handlePreSetPreviewCheck, handleStartSetFromPreview, handleCheckLighting,
    handleDismissPartialTrackingBanner, confirmDiscardRecording, handleReacquireSubject,
    handleSaveOnlyRecording, handlePublishRecording,
  };
}

export type ScanActionsCtx = ScanRecordingCtx & ReturnType<typeof useScanActions>;

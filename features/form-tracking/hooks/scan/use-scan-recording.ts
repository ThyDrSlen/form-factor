import { useCallback, useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert, Platform } from 'react-native';
import { uploadWorkoutVideo } from '@/lib/services/video-service';
import { errorWithTs, warnWithTs, logWithTs } from '@/lib/logger';
import * as MediaLibrary from 'expo-media-library';
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
import { buildVideoMetricsForClip } from '@/lib/services/video-metrics';
import { ClipUploadMetrics, MAX_UPLOAD_BYTES } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanWatchMirrorCtx } from '@/features/form-tracking/hooks/scan/use-scan-watch-mirror';

export function useScanRecording(ctx: ScanWatchMirrorCtx) {
  const {
    DEV, activeWorkoutDef, ensureMediaLibraryPermission, fixturePlaybackEnabled,
    isFinalizingRecording, isRecording, isTracking, jointAngles, lastPoseTimestampRef,
    lastUploadPayloadRef, latestMetricsForUpload, pendingRecordAfterTrackingRef, recordPreview,
    recordingActiveRef, recordingFqiScoresRef, recordingQuality, recordingStartAtRef,
    recordingStartEpochMsRef, recordingStartFrameTimestampRef, recordingStartRepsRef,
    recordingStopInFlightRef, repCount, resumeTrackingAfterPermissionGrantRef, sessionIdRef,
    setIsPreviewVisible, setIsRecording, setPreviewError, setRecordPreview,
    setRecordingStartStatus, setShowCameraGuide, setUploadRetryPayload, setUploading, showToast,
    startTracking, stopRecordingCore, uploadRetryPayload, uploading,
  } = ctx;

    const uploadRecordedVideo = useCallback(async (payload: { uri: string; exercise: string; metrics: ClipUploadMetrics }) => {
      if (uploading) return false;
      // Stash the payload up-front so a post-failure Retry can re-invoke
      // without requiring the preview sheet to stay mounted.
      lastUploadPayloadRef.current = payload;
      try {
        setPreviewError(null);
        const info = await FileSystem.getInfoAsync(payload.uri);
        if (!info.exists) {
          const message = 'Recorded file is not accessible.';
          setPreviewError(message);
          Alert.alert('Recording missing', message);
          return false;
        }
        if (info.size && info.size > MAX_UPLOAD_BYTES) {
          const message = 'Max file size is 250MB.';
          setPreviewError(message);
          Alert.alert('File too large', message);
          return false;
        }
        setUploading(true);
        await uploadWorkoutVideo({
          fileUri: payload.uri,
          exercise: payload.exercise,
          metrics: payload.metrics,
        });
        // Clear any retry affordance on success.
        setUploadRetryPayload(null);
        return true;
      } catch (error) {
        errorWithTs('[ScanARKit] Upload recorded video failed', error);
        const message = error instanceof Error ? error.message : 'Could not upload recording.';
        setPreviewError(message);
        // Keep the Alert for the active preview flow, but also surface a
        // persistent banner with a Retry button that stays visible after
        // the user dismisses the Alert and closes the preview.
        setUploadRetryPayload({
          uri: payload.uri,
          exercise: payload.exercise,
          metrics: payload.metrics,
          message,
        });
        Alert.alert('Upload failed', message);
        return false;
      } finally {
        setUploading(false);
      }
    }, [lastUploadPayloadRef, setPreviewError, setUploadRetryPayload, setUploading, uploading]);

    const retryUploadRecordedVideo = useCallback(() => {
      const pending = uploadRetryPayload ?? lastUploadPayloadRef.current;
      if (!pending) {
        setUploadRetryPayload(null);
        return;
      }
      // Clear the banner optimistically; uploadRecordedVideo will
      // re-arm it on a subsequent failure and will clear on success.
      setUploadRetryPayload(null);
      void uploadRecordedVideo({
        uri: pending.uri,
        exercise: pending.exercise,
        metrics: pending.metrics,
      });
    }, [uploadRetryPayload, lastUploadPayloadRef, setUploadRetryPayload, uploadRecordedVideo]);

    const dismissUploadRetry = useCallback(() => {
      setUploadRetryPayload(null);
    }, [setUploadRetryPayload]);

    const saveRecordingToCameraRoll = useCallback(async (uri: string) => {
      if (Platform.OS === 'web') return false;
      const hasAccess = await ensureMediaLibraryPermission();
      if (!hasAccess) {
        Alert.alert(
          'Photos permission needed',
          'Enable Photos access to save recordings to your camera roll.'
        );
        return false;
      }
      try {
        await MediaLibrary.saveToLibraryAsync(uri);
        return true;
      } catch (error) {
        errorWithTs('[ScanARKit] Failed to save recording to camera roll', error);
        return false;
      }
    }, [ensureMediaLibraryPermission]);

    const cleanupLocalRecording = useCallback(async (uri: string) => {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch (error) {
        warnWithTs('[ScanARKit] Failed to delete local recording', error);
      }
    }, []);

    const startRecordingVideo = useCallback(async () => {
      if (isRecording || isFinalizingRecording || recordingStopInFlightRef.current) return;
      if (recordPreview) {
        Alert.alert('Finish review', 'Save or discard the previous recording before starting a new one.');
        return;
      }
      if (fixturePlaybackEnabled) {
        Alert.alert('Fixture playback enabled', 'Disable fixturePlayback query param to record live tracking.');
        return;
      }
      if (!isTracking) {
        Alert.alert('Start tracking first', 'Begin tracking before recording your set.');
        return;
      }
      if (Platform.OS !== 'ios') {
        Alert.alert('Recording unavailable', 'Native AR recording is only available on iOS.');
        return;
      }
      try {
        if (DEV) logWithTs('[ScanARKit] Starting recording...');
        pendingRecordAfterTrackingRef.current = false;
        setRecordingStartStatus('idle');
        setShowCameraGuide(false);
        setPreviewError(null);
        recordingActiveRef.current = true;
        recordingStartAtRef.current = new Date().toISOString();
        recordingStartEpochMsRef.current = Date.now();
        recordingStartFrameTimestampRef.current = lastPoseTimestampRef.current;
        recordingStartRepsRef.current = repCount;
        recordingFqiScoresRef.current = [];
        setIsRecording(true);
        await BodyTracker.startRecording({ quality: recordingQuality });
      } catch (error) {
        errorWithTs('[ScanARKit] Failed to start ARKit recording', error);
        recordingActiveRef.current = false;
        setIsRecording(false);
        Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not start recording.');
      }
    }, [isRecording, isFinalizingRecording, recordingStopInFlightRef, recordPreview, fixturePlaybackEnabled, isTracking, DEV, pendingRecordAfterTrackingRef, setRecordingStartStatus, setShowCameraGuide, setPreviewError, recordingActiveRef, recordingStartAtRef, recordingStartEpochMsRef, recordingStartFrameTimestampRef, lastPoseTimestampRef, recordingStartRepsRef, repCount, recordingFqiScoresRef, setIsRecording, recordingQuality]);

  useEffect(() => {
    if (!pendingRecordAfterTrackingRef.current) {
      return;
    }
    if (isRecording || isFinalizingRecording) {
      pendingRecordAfterTrackingRef.current = false;
      setRecordingStartStatus('idle');
      return;
    }
    if (recordPreview) {
      pendingRecordAfterTrackingRef.current = false;
      setRecordingStartStatus('idle');
      return;
    }
    if (!isTracking) {
      return;
    }
    if (!jointAngles) {
      setRecordingStartStatus('waiting-for-skeleton');
      return;
    }
    pendingRecordAfterTrackingRef.current = false;
    setRecordingStartStatus('idle');
    void startRecordingVideo();
  }, [isFinalizingRecording, isRecording, isTracking, jointAngles, pendingRecordAfterTrackingRef, recordPreview, setRecordingStartStatus, startRecordingVideo]);

  const stopRecordingVideo = useCallback(async () => {
    if (!isRecording || recordingStopInFlightRef.current) return;
    try {
        if (DEV) logWithTs('[ScanARKit] Stopping recording...');
        const recordingEndAt = new Date().toISOString();
          const uri = await stopRecordingCore();
          if (uri) {
            const info = await FileSystem.getInfoAsync(uri);
            const sizeBytes = info.exists ? info.size ?? null : null;
          const repsAtStop = repCount;
          const repsInClip = Math.max(0, repsAtStop - recordingStartRepsRef.current);

          const metricsSnapshot: ClipUploadMetrics = buildVideoMetricsForClip({
            baseMetrics: { ...latestMetricsForUpload, reps: repsInClip },
            sessionId: sessionIdRef.current,
            recordingQuality,
            recordingStartAt: recordingStartAtRef.current ?? recordingEndAt,
            recordingEndAt,
            recordingStartFrameTimestamp: recordingStartFrameTimestampRef.current,
            recordingEndFrameTimestamp: lastPoseTimestampRef.current,
            repFqiScores: recordingFqiScoresRef.current,
          });
          setRecordPreview({
            uri,
            exercise: activeWorkoutDef.displayName,
            metrics: metricsSnapshot,
            sizeBytes,
            savedToLibrary: false,
          });
          setPreviewError(null);
          setIsPreviewVisible(true);
        } else {
          Alert.alert('Recording', 'No video file was generated.');
        }
    } catch (error) {
      errorWithTs('[ScanARKit] Failed to stop ARKit recording', error);
      setIsRecording(false);
      Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not stop recording.');
    } finally {
      recordingActiveRef.current = false;
    }
  }, [isRecording, recordingStopInFlightRef, DEV, stopRecordingCore, repCount, recordingStartRepsRef, latestMetricsForUpload, sessionIdRef, recordingQuality, recordingStartAtRef, recordingStartFrameTimestampRef, lastPoseTimestampRef, recordingFqiScoresRef, setRecordPreview, activeWorkoutDef.displayName, setPreviewError, setIsPreviewVisible, setIsRecording, recordingActiveRef]);

  const handleRecordSetPress = useCallback(async () => {
    if (isFinalizingRecording) return;
    if (isRecording) {
      await stopRecordingVideo();
      return;
    }
    if (recordPreview || fixturePlaybackEnabled || Platform.OS !== 'ios') {
      await startRecordingVideo();
      return;
    }
    setShowCameraGuide(false);
    if (!isTracking) {
      pendingRecordAfterTrackingRef.current = true;
      setRecordingStartStatus('starting-camera');
      showToast('Starting camera — recording will begin when your skeleton appears.', {
        type: 'info',
      });
      const started = await startTracking();
      if (!started) {
        pendingRecordAfterTrackingRef.current = true;
        resumeTrackingAfterPermissionGrantRef.current = true;
        setRecordingStartStatus('starting-camera');
        showToast('Camera needs permission. Grant access and we’ll keep starting your set.', {
          type: 'error',
        });
        return;
      }
      if (!jointAngles) {
        setRecordingStartStatus('waiting-for-skeleton');
      }
      return;
    }
    if (!jointAngles) {
      pendingRecordAfterTrackingRef.current = true;
      setRecordingStartStatus('waiting-for-skeleton');
      showToast('Step fully into frame — recording will start as soon as we see your skeleton.', {
        type: 'info',
      });
      return;
    }
    await startRecordingVideo();
  }, [fixturePlaybackEnabled, isFinalizingRecording, isRecording, isTracking, jointAngles, pendingRecordAfterTrackingRef, recordPreview, resumeTrackingAfterPermissionGrantRef, setRecordingStartStatus, setShowCameraGuide, showToast, startRecordingVideo, startTracking, stopRecordingVideo]);

  const handleCameraPermissionResume = useCallback(() => {
    if (!resumeTrackingAfterPermissionGrantRef.current) {
      return;
    }
    if (pendingRecordAfterTrackingRef.current) {
      setRecordingStartStatus('starting-camera');
    }
    void startTracking();
  }, [pendingRecordAfterTrackingRef, resumeTrackingAfterPermissionGrantRef, setRecordingStartStatus, startTracking]);

  return {
    uploadRecordedVideo, retryUploadRecordedVideo, dismissUploadRetry, saveRecordingToCameraRoll,
    cleanupLocalRecording, startRecordingVideo, handleRecordSetPress,
    handleCameraPermissionResume,
  };
}

export type ScanRecordingCtx = ScanWatchMirrorCtx & ReturnType<typeof useScanRecording>;

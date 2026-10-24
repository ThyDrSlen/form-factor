import { useCallback, useEffect } from 'react';
import { logWithTs, warnWithTs } from '@/lib/logger';
import type { PullupScoringResult } from '@/lib/tracking-quality';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { MEDIAPIPE_POSE_LANDMARKER_VERSION } from '@/lib/pose/adapters/mediapipe-workout-adapter';
import type { RecordingQuality } from '@/lib/services/video-metrics';
import { createBaselineDebugMetrics, PARTIAL_TRACKING_BADGE_MIN_VISIBLE_MS, PARTIAL_TRACKING_BADGE_HIDE_DELAY_MS, QUALITY_STORAGE_KEY, MEDIAPIPE_LITE_MODEL_ASSET, MEDIAPIPE_SHADOW_POLL_INTERVAL_MS } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanSessionStateCtx } from '@/features/form-tracking/hooks/scan/use-scan-session-state';

export function useScanDiagnostics(ctx: ScanSessionStateCtx) {
  const {
    DEV, activePhaseRef, baselineDebugEnabled, baselineDebugEnabledRef, baselineDebugMetricsRef,
    cueHysteresisControllerRef, cueHysteresisLastTickRef, fixturePlaybackEnabled, isTracking,
    mediaPipeModelPath, mediaPipeModelVersionRef, mediaPipePollInFlightRef,
    mediaPipePollTimerRef, mediaPipePoseRef, partialTrackingBannerDismissedUntilMs,
    partialTrackingHideTimerRef, partialTrackingVisibleUntilMsRef, partialWarningVisibleRef,
    repCount, restPhaseRef, setIsPoseModelLoading, setMediaPipeModelPath, setRecordingQuality,
    setShadowProviderRuntime, setShowPartialTrackingBadge, setTrackingRecoveredPulseId,
    shadowModeEnabled, shadowModeEnabledRef, shadowProviderRuntime, shadowProviderRuntimeRef,
    showToast, stablePrimaryCueRef, subjectLockEnabled, supportStatus, trackingDebugEnabledRef,
    trackingRecoveredTimerRef,
  } = ctx;

  const logTrackingDebug = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!trackingDebugEnabledRef.current) return;
    logWithTs(`[ScanARKit][tracking-debug] ${event}`, payload);
  }, [trackingDebugEnabledRef]);

  const resetBaselineDebugMetrics = useCallback(() => {
    baselineDebugMetricsRef.current = createBaselineDebugMetrics();
  }, [baselineDebugMetricsRef]);

  const resetCueHysteresis = useCallback(() => {
    cueHysteresisControllerRef.current.resetAll();
    cueHysteresisLastTickRef.current = null;
    stablePrimaryCueRef.current = null;
  }, [cueHysteresisControllerRef, cueHysteresisLastTickRef, stablePrimaryCueRef]);

  const updatePartialTrackingBadgeVisibility = useCallback((
    visibilityBadge: PullupScoringResult['visibility_badge'],
    source: 'frame-live' | 'onPullupScoring-rep-complete' | 'unknown' = 'unknown'
  ) => {
    if (visibilityBadge === 'partial' && partialTrackingHideTimerRef.current) {
      clearTimeout(partialTrackingHideTimerRef.current);
      partialTrackingHideTimerRef.current = null;
    }

    const now = Date.now();
    logTrackingDebug('partial-badge-update', {
      ts: now,
      source,
      visibilityBadge,
      fixturePlaybackEnabled,
      repCount,
      activePhase: activePhaseRef.current,
    });

    if (visibilityBadge === 'partial') {
      if (trackingRecoveredTimerRef.current) {
        clearTimeout(trackingRecoveredTimerRef.current);
        trackingRecoveredTimerRef.current = null;
      }
      setTrackingRecoveredPulseId(null);
      partialTrackingVisibleUntilMsRef.current = now + PARTIAL_TRACKING_BADGE_MIN_VISIBLE_MS;
      if (now >= partialTrackingBannerDismissedUntilMs) {
        partialWarningVisibleRef.current = true;
        setShowPartialTrackingBadge(true);
      }
      return;
    }

    // Keep the first recovery deadline; continuous healthy frames must not
    // postpone it indefinitely. A partial frame above cancels the deadline.
    if (partialTrackingHideTimerRef.current || !partialWarningVisibleRef.current) return;

    const hideInMs = Math.max(0, partialTrackingVisibleUntilMsRef.current - now) + PARTIAL_TRACKING_BADGE_HIDE_DELAY_MS;
    partialTrackingHideTimerRef.current = setTimeout(() => {
      setShowPartialTrackingBadge(false);
      partialTrackingHideTimerRef.current = null;
      if (partialWarningVisibleRef.current) {
        partialWarningVisibleRef.current = false;
        if (trackingRecoveredTimerRef.current) clearTimeout(trackingRecoveredTimerRef.current);
        setTrackingRecoveredPulseId(Date.now());
        trackingRecoveredTimerRef.current = setTimeout(() => {
          setTrackingRecoveredPulseId(null);
          trackingRecoveredTimerRef.current = null;
        }, 1800);
      }
    }, hideInMs);
  }, [activePhaseRef, fixturePlaybackEnabled, logTrackingDebug, partialTrackingBannerDismissedUntilMs, partialTrackingHideTimerRef, partialTrackingVisibleUntilMsRef, partialWarningVisibleRef, repCount, setShowPartialTrackingBadge, setTrackingRecoveredPulseId, trackingRecoveredTimerRef]);

  useEffect(() => {
    return () => {
      if (partialTrackingHideTimerRef.current) {
        clearTimeout(partialTrackingHideTimerRef.current);
        partialTrackingHideTimerRef.current = null;
      }
      if (trackingRecoveredTimerRef.current) {
        clearTimeout(trackingRecoveredTimerRef.current);
        trackingRecoveredTimerRef.current = null;
      }
    };
  }, [partialTrackingHideTimerRef, trackingRecoveredTimerRef]);

  useEffect(() => {
    baselineDebugEnabledRef.current = baselineDebugEnabled;
    if (!baselineDebugEnabled) {
      resetBaselineDebugMetrics();
    }
  }, [baselineDebugEnabled, baselineDebugEnabledRef, resetBaselineDebugMetrics]);

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(QUALITY_STORAGE_KEY)
      .then((value) => {
        if (!isMounted || !value) return;
        if (value === 'low' || value === 'medium' || value === 'high') {
          setRecordingQuality(value);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [setRecordingQuality]);

  useEffect(() => {
    shadowModeEnabledRef.current = shadowModeEnabled;
  }, [shadowModeEnabled, shadowModeEnabledRef]);

  useEffect(() => {
    shadowProviderRuntimeRef.current = shadowProviderRuntime;
  }, [shadowProviderRuntime, shadowProviderRuntimeRef]);

  useEffect(() => {
    BodyTracker.setSubjectLockEnabled(subjectLockEnabled);
  }, [subjectLockEnabled]);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS !== 'ios') {
      setMediaPipeModelPath(null);
      setIsPoseModelLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadBundledModelPath = async () => {
      try {
        const modelAsset = Asset.fromModule(MEDIAPIPE_LITE_MODEL_ASSET);
        await modelAsset.downloadAsync();

        if (cancelled) {
          return;
        }

        const resolvedPath = modelAsset.localUri ?? modelAsset.uri ?? null;
        setMediaPipeModelPath(resolvedPath);

        if (DEV && resolvedPath) {
          logWithTs('[ScanARKit] MediaPipe model resolved', resolvedPath);
        }
      } catch (error) {
        if (!cancelled && DEV) {
          warnWithTs('[ScanARKit] Failed to resolve bundled MediaPipe model asset', error);
        }
        if (!cancelled) {
          setMediaPipeModelPath(null);
        }
      } finally {
        if (!cancelled) {
          setIsPoseModelLoading(false);
        }
      }
    };

    void loadBundledModelPath();

    return () => {
      cancelled = true;
    };
  }, [DEV, setIsPoseModelLoading, setMediaPipeModelPath]);

  // Safety: once BodyTracker finishes its capability probe, stop
  // showing the loading modal regardless of the asset path resolution
  // state above. This covers the unsupported case where the effect
  // above never runs (non-iOS) plus any race where supportStatus
  // resolves before the asset download finishes.
  useEffect(() => {
    if (supportStatus === 'supported' || supportStatus === 'unsupported') {
      setIsPoseModelLoading(false);
    }
  }, [setIsPoseModelLoading, supportStatus]);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS !== 'ios' || !shadowModeEnabled || !isTracking) {
      setShadowProviderRuntime('mediapipe_proxy');
      mediaPipePoseRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    const configure = async () => {
      const configured = await BodyTracker.configureMediaPipeShadow({
        modelPath: mediaPipeModelPath ?? undefined,
        modelName: 'pose_landmarker_lite',
        modelVersion: MEDIAPIPE_POSE_LANDMARKER_VERSION,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      if (cancelled) {
        return;
      }

      if (configured) {
        setShadowProviderRuntime('mediapipe');
        if (DEV) {
          logWithTs('[ScanARKit] MediaPipe shadow configured');
        }
      } else {
        setShadowProviderRuntime('mediapipe_proxy');
        mediaPipePoseRef.current = null;
        if (DEV) {
          warnWithTs('[ScanARKit] MediaPipe shadow unavailable, falling back to proxy provider');
        }
        // Surface the fallback to the user. Previously this was DEV-only,
        // so prod users would silently drop onto the proxy provider with
        // no explanation for the accuracy regression.
        showToast('Pose tracking degraded — using fallback.', { type: 'info' });
      }
    };

    configure().catch((error) => {
      if (!cancelled && DEV) {
        warnWithTs('[ScanARKit] Failed to configure MediaPipe shadow', error);
      }
      if (!cancelled) {
        setShadowProviderRuntime('mediapipe_proxy');
        showToast('Pose tracking degraded — using fallback.', { type: 'info' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [DEV, isTracking, mediaPipeModelPath, mediaPipePoseRef, setShadowProviderRuntime, shadowModeEnabled, showToast]);

  useEffect(() => {
    const shouldPollMediaPipe =
      Platform.OS === 'ios' &&
      isTracking &&
      shadowModeEnabled &&
      shadowProviderRuntime === 'mediapipe';

    // Shared teardown helper — called unconditionally from the effect
    // cleanup so the interval + in-flight flag reset always fire on
    // unmount regardless of which branch of the effect ran. Previously the
    // cleanup duplicated this logic and could drift from the guard-block
    // version if only one site was updated during a refactor.
    const teardownPoll = () => {
      if (mediaPipePollTimerRef.current) {
        clearInterval(mediaPipePollTimerRef.current);
        mediaPipePollTimerRef.current = null;
      }
      mediaPipePollInFlightRef.current = false;
    };

    if (!shouldPollMediaPipe) {
      teardownPoll();
      mediaPipePoseRef.current = null;
      return teardownPoll;
    }

    let active = true;

    const poll = async () => {
      if (!active || mediaPipePollInFlightRef.current) {
        return;
      }

      // Skip heavy native poll while the user is in the resting/idle phase
      // between reps — shadow comparison only matters during the active rep.
      if (activePhaseRef.current === restPhaseRef.current) {
        return;
      }

      mediaPipePollInFlightRef.current = true;
      try {
        const payload = await BodyTracker.getCurrentMediaPipePose2D();
        if (!active || !payload || payload.landmarks.length === 0) {
          return;
        }
        mediaPipePoseRef.current = payload;
        if (payload.modelVersion) {
          mediaPipeModelVersionRef.current = payload.modelVersion;
        }
      } catch (error) {
        if (DEV) {
          warnWithTs('[ScanARKit] MediaPipe shadow poll failed', error);
        }
      } finally {
        mediaPipePollInFlightRef.current = false;
      }
    };

    void poll();
    mediaPipePollTimerRef.current = setInterval(() => {
      void poll();
    }, MEDIAPIPE_SHADOW_POLL_INTERVAL_MS);

    return () => {
      active = false;
      // Always run teardown, unconditionally, outside any guard — a
      // leaked interval keeps waking the native bridge after the user
      // leaves the scan tab and tanks battery/thermal.
      teardownPoll();
    };
  }, [DEV, activePhaseRef, isTracking, mediaPipeModelVersionRef, mediaPipePollInFlightRef, mediaPipePollTimerRef, mediaPipePoseRef, restPhaseRef, shadowModeEnabled, shadowProviderRuntime]);

  const updateRecordingQuality = useCallback(async (value: RecordingQuality) => {
    setRecordingQuality(value);
    try {
      await AsyncStorage.setItem(QUALITY_STORAGE_KEY, value);
    } catch {}
  }, [setRecordingQuality]);

  return {
    logTrackingDebug, resetBaselineDebugMetrics, resetCueHysteresis,
    updatePartialTrackingBadgeVisibility, updateRecordingQuality,
  };
}

export type ScanDiagnosticsCtx = ScanSessionStateCtx & ReturnType<typeof useScanDiagnostics>;

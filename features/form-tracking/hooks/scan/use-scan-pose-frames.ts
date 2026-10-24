import { useEffect } from 'react';
import { logWithTs, warnWithTs, errorWithTs } from '@/lib/logger';
import { incrementPoseLost } from '@/lib/services/telemetry-context';
import { createRealtimeFormEngineState, processRealtimeAngles } from '@/lib/pose/realtime-form-engine';
import { getWorkoutByMode } from '@/lib/workouts';
import { BodyTracker, type JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { resolveFrameJoints, liveRepAngles, recordFrameLatency } from '@/features/form-tracking/hooks/scan/scan-frame-helpers';
import { buildArkitCanonicalFrame } from '@/lib/pose/adapters/arkit-workout-adapter';
import { selectShadowProvider, bumpShadowProviderCount } from '@/lib/pose/shadow-provider';
import { buildMediaPipeShadowFrameFromLandmarks } from '@/lib/pose/adapters/mediapipe-workout-adapter';
import { buildMediaPipeShadowFrameFromArkit2D } from '@/lib/pose/adapters/mediapipe-shadow-proxy';
import { compareJointAngles, accumulateShadowStats } from '@/lib/pose/shadow-metrics';
import { logPoseSample } from '@/lib/services/pose-logger';
import type { WorkoutMetrics } from '@/lib/types/workout-definitions';
import { scorePullupWithComponentAvailability } from '@/lib/tracking-quality';
import * as Haptics from 'expo-haptics';
import { nowMs, MEDIAPIPE_MAX_TIMESTAMP_SKEW_SEC, FPS_PUBLISH_INTERVAL_MS } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanModeAndPlaybackCtx } from '@/features/form-tracking/hooks/scan/use-scan-mode-and-playback';

export function useScanPoseFrames(ctx: ScanModeAndPlaybackCtx) {
  const {
    activePhaseRef, activeWorkoutDef, baselineDebugEnabledRef, baselineDebugMetricsRef,
    detectionMode, fixturePlaybackEnabled, fps, fpsStatsRef, frameStatsRef, isTracking,
    jointAnglesStateRef, lastConfidenceTierRef, lastFpsPublishMsRef, lastLivePartialBadgeRef,
    lastMetricsPublishRef, lastPoseTimestampRef, lastShadowMeanAbsDeltaRef,
    lastTrackingQualityRef, logTrackingDebug, mediaPipeModelVersionRef, mediaPipePoseRef, pose,
    pose2D, pose2DCacheKeysRef, pose2DCacheRef, processWorkoutFrame, realtimeFormEngineRef,
    repIndexTrackerRef, repStartTsRef, resetCueHysteresis, resetWorkoutController, sessionIdRef,
    setActiveMetrics, setFps, setJointAngles, setLivePullupPartialStatus,
    setSmoothedPose2DJoints, shadowModeEnabledRef, shadowProviderCountsRef,
    shadowProviderRuntimeRef, shadowStatsPerRepRef, shadowStatsRef, showToast, smoothedPose2DRef,
    trackingDebugEnabledRef, transitionPhase, updatePartialTrackingBadgeVisibility,
  } = ctx;

  // Debug pose updates (throttled logging)
  useEffect(() => {
    const frameProcessStartMs = baselineDebugEnabledRef.current ? nowMs() : null;
    if (!pose) {
      if (baselineDebugEnabledRef.current) {
        logWithTs('[ScanARKit] ℹ️ No pose data');
      }
      // Track pose lost if we were previously tracking
      if (jointAnglesStateRef.current !== null && isTracking) {
        incrementPoseLost();
      }
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      lastFpsPublishMsRef.current = 0;
      setJointAngles(null);
      jointAnglesStateRef.current = null;
      realtimeFormEngineRef.current = createRealtimeFormEngineState();
      lastShadowMeanAbsDeltaRef.current = null;
      setFps(0);
      setSmoothedPose2DJoints(null);
      smoothedPose2DRef.current = null;
      pose2DCacheRef.current.clear();
      pose2DCacheKeysRef.current = null;
      lastMetricsPublishRef.current = null;
      setActiveMetrics(null);
      setLivePullupPartialStatus(null);
      lastLivePartialBadgeRef.current = null;
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      repIndexTrackerRef.current.reset();
      resetWorkoutController({ preserveRepCount: true });
      resetCueHysteresis();
      return;
    }

    lastPoseTimestampRef.current = pose.timestamp;

    // Only log every 30 frames (once per second at 30fps)
    const shouldLog = frameStatsRef.current.frameCount % 30 === 0;
    
    if (shouldLog && baselineDebugEnabledRef.current) {
      logWithTs('[ScanARKit] 📊 Pose update:', {
        joints: pose.joints.length,
        timestamp: pose.timestamp,
        isTracking: pose.isTracking,
        frameCount: frameStatsRef.current.frameCount
      });
    }

    try {
      const angles = BodyTracker.calculateAllAngles(pose, detectionMode);
      const { valid, jointLookupDebug, confidence } = resolveFrameJoints(
        pose, detectionMode, angles, trackingDebugEnabledRef.current,
      );
      if (trackingDebugEnabledRef.current) {
        logTrackingDebug('joint-lookup-and-visibility', {
          ts: Date.now(),
          frameSource: fixturePlaybackEnabled ? 'fixture' : 'live',
          poseTimestamp: pose.timestamp,
          jointLookup: jointLookupDebug,
          valid,
          confidence,
        });
      }
      const smoothingResult =
        angles
          ? processRealtimeAngles({
              state: realtimeFormEngineRef.current,
              angles,
              valid,
              timestampSec: pose.timestamp,
              shadowMeanAbsDelta: lastShadowMeanAbsDeltaRef.current,
              workoutId: detectionMode,
            })
          : null;
      // Never keep counting curls from a stale angle snapshot if arms/hips
      // disappear. Missing knees, however, no longer invalidate this frame.
      const next: JointAngles | null = smoothingResult?.angles ?? (
        detectionMode === 'dumbbell_curl' ? null : realtimeFormEngineRef.current.smoothed
      );

      if (shouldLog && next && baselineDebugEnabledRef.current) {
        logWithTs('[ScanARKit] 📐 Joint angles:', {
          leftKnee: next.leftKnee.toFixed(1),
          rightKnee: next.rightKnee.toFixed(1),
          leftElbow: next.leftElbow.toFixed(1),
          rightElbow: next.rightElbow.toFixed(1),
          smoothingAlpha: smoothingResult?.alpha?.toFixed(2) ?? null,
          trackingQuality: smoothingResult?.trackingQuality?.toFixed(2) ?? null,
        });
      }
      
      if (next) {
        const existingAngles = jointAnglesStateRef.current;
        const angleDrift =
          !existingAngles ||
          Math.abs(existingAngles.leftElbow - next.leftElbow) > 0.25 ||
          Math.abs(existingAngles.rightElbow - next.rightElbow) > 0.25 ||
          Math.abs(existingAngles.leftShoulder - next.leftShoulder) > 0.35 ||
          Math.abs(existingAngles.rightShoulder - next.rightShoulder) > 0.35 ||
          Math.abs(existingAngles.leftKnee - next.leftKnee) > 0.5 ||
          Math.abs(existingAngles.rightKnee - next.rightKnee) > 0.5;

        if (angleDrift) {
          jointAnglesStateRef.current = next;
          setJointAngles(next);
        }

        const jointsMap = new Map<string, { x: number; y: number; isTracked: boolean }>();
        pose.joints.forEach((joint) => {
          jointsMap.set(joint.name, { x: joint.x, y: joint.y, isTracked: joint.isTracked });
        });

        const canonicalFrame = buildArkitCanonicalFrame({
          angles: next,
          pose2D,
          timestamp: pose.timestamp,
        });

        let shadowFrame = null;
        if (shadowModeEnabledRef.current) {
          const latestMediaPipePose = mediaPipePoseRef.current;
           const selectedProvider = selectShadowProvider({
             preferredProvider: shadowProviderRuntimeRef.current,
             primaryTimestamp: pose.timestamp,
             mediaPipeTimestamp: latestMediaPipePose?.timestamp,
             maxTimestampSkewSec: MEDIAPIPE_MAX_TIMESTAMP_SKEW_SEC,
             isInActiveRep: repIndexTrackerRef.current.current() !== null,
           });
           logTrackingDebug('shadow-provider-selection', {
             ts: Date.now(),
             primaryTimestamp: pose.timestamp,
             mediaPipeTimestamp: latestMediaPipePose?.timestamp ?? null,
             selectedProvider,
             preferredProvider: shadowProviderRuntimeRef.current,
             isInActiveRep: repIndexTrackerRef.current.current() !== null,
           });

          if (selectedProvider === 'mediapipe' && latestMediaPipePose?.landmarks?.length) {
            shadowFrame = buildMediaPipeShadowFrameFromLandmarks({
              primaryAngles: next,
              landmarks: latestMediaPipePose.landmarks,
              timestamp: pose.timestamp,
              inferenceMs: latestMediaPipePose.inferenceMs,
              modelVersion: latestMediaPipePose.modelVersion ?? mediaPipeModelVersionRef.current,
            });
            if (latestMediaPipePose.modelVersion) {
              mediaPipeModelVersionRef.current = latestMediaPipePose.modelVersion;
            }
          } else {
            shadowFrame = buildMediaPipeShadowFrameFromArkit2D({
              primaryAngles: next,
              arkitJointMap: canonicalFrame.joints,
              timestamp: pose.timestamp,
            });
          }
        }

        const shadowComparison = shadowFrame
          ? compareJointAngles(next, shadowFrame.angles, {
              provider: shadowFrame.provider,
              modelVersion: shadowFrame.modelVersion,
              inferenceMs: shadowFrame.inferenceMs,
              coverageRatio: shadowFrame.coverageRatio,
              workoutId: detectionMode,
            })
          : null;

        if (shadowComparison) {
          accumulateShadowStats(shadowStatsRef.current, shadowComparison);
          accumulateShadowStats(shadowStatsPerRepRef.current, shadowComparison);
          lastShadowMeanAbsDeltaRef.current = shadowComparison.meanAbsDelta;
          if (shadowFrame) {
            bumpShadowProviderCount(shadowProviderCountsRef.current, shadowFrame.provider);
          }
        } else {
          lastShadowMeanAbsDeltaRef.current = null;
        }

        // Log pose sample for ML modeling (only when tracking is active)
        if (next && isTracking) {
          const currentRepIndex = repIndexTrackerRef.current.current();

          logPoseSample({
            sessionId: sessionIdRef.current,
            frameTimestamp: pose.timestamp,
            exerciseMode: detectionMode,
            phase: activePhaseRef.current,
            repNumber: currentRepIndex,
            angles: next,
            fpsAtCapture: fps,
            shadowProvider: shadowFrame?.provider,
            shadowModelVersion: shadowFrame?.modelVersion,
            shadowAngles: shadowComparison?.shadowAngles,
            shadowAngleDelta: shadowComparison?.deltaByJoint,
            shadowMeanAbsDelta: shadowComparison?.meanAbsDelta,
            shadowP95AbsDelta: shadowComparison?.p95AbsDelta,
            shadowInferenceMs: shadowComparison?.inferenceMs,
            shadowComparedJoints: shadowComparison?.comparedJoints,
            shadowCoverageRatio: shadowComparison?.coverageRatio,
          }).catch((error) => {
            if (__DEV__) {
              warnWithTs('[ScanARKit] Failed to log pose sample', error);
            }
          });
        }

        const metrics = activeWorkoutDef.calculateMetrics(next, jointsMap) as WorkoutMetrics;
        const now = Date.now();
        if (lastMetricsPublishRef.current === null || now - lastMetricsPublishRef.current >= 100) {
          lastMetricsPublishRef.current = now;
          setActiveMetrics(metrics);
        }

        const shouldComputeLivePartial = detectionMode === 'pullup' && (isTracking || fixturePlaybackEnabled);
        if (shouldComputeLivePartial) {
          const livePartialScoring = scorePullupWithComponentAvailability({
            repAngles: liveRepAngles(next),
            // Use real elapsed time for the in-flight rep when available so
            // the live partial scoring (visibility badge + component
            // availability) reflects actual tempo instead of a 1s constant.
            // Fall back to 1000ms before the first rep-start transition.
            durationMs: repStartTsRef.current > 0
              ? Math.max(1, Date.now() - repStartTsRef.current)
              : 1000,
            joints: canonicalFrame.joints,
          });

          setLivePullupPartialStatus((previous) => {
            const badge = livePartialScoring.visibility_badge;
            const missing = livePartialScoring.missing_components;
            if (previous?.visibility_badge === badge &&
                previous.missing_components.length === missing.length &&
                previous.missing_components.every((component, index) => component === missing[index])) {
              return previous;
            }
            return { visibility_badge: badge, missing_components: missing };
          });

          const previousPartialBadge = lastLivePartialBadgeRef.current;
          if (previousPartialBadge !== livePartialScoring.visibility_badge) {
            lastLivePartialBadgeRef.current = livePartialScoring.visibility_badge;
            updatePartialTrackingBadgeVisibility(livePartialScoring.visibility_badge, 'frame-live');
          }
        } else {
          setLivePullupPartialStatus(null);
          lastLivePartialBadgeRef.current = null;
        }

        processWorkoutFrame(next, jointsMap, {
          metrics,
          trackingQuality: smoothingResult?.trackingQuality,
          shadowMeanAbsDelta: shadowComparison?.meanAbsDelta,
        });
        if (typeof smoothingResult?.trackingQuality === 'number') {
          lastTrackingQualityRef.current = smoothingResult.trackingQuality;
          // Mid-set confidence degradation: warn once when the tier flips from
          // high → low during an active rep. The tier is only classified when
          // we are mid-set (between repBoundary.startPhase and the next rep-
          // complete), so between-set frames stay quiet. A Schmitt-trigger-
          // style pair of thresholds avoids chatter around the boundary.
          const HIGH_ENTER = 0.7;
          const LOW_ENTER = 0.5;
          const quality = smoothingResult.trackingQuality;
          const inActiveRep = repIndexTrackerRef.current.current() !== null;
          if (inActiveRep) {
            let nextTier: 'high' | 'low' | null = lastConfidenceTierRef.current;
            if (quality >= HIGH_ENTER) nextTier = 'high';
            else if (quality <= LOW_ENTER) nextTier = 'low';
            const prevTier = lastConfidenceTierRef.current;
            if (prevTier === 'high' && nextTier === 'low') {
              showToast('Tracking degraded — check lighting / framing', {
                type: 'error',
              });
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              ).catch(() => {
                /* haptics unavailable — silent */
              });
            }
            lastConfidenceTierRef.current = nextTier;
          } else {
            // Outside a rep: reset so the next rep's baseline starts neutral.
            lastConfidenceTierRef.current = null;
          }
        }
      } else {
        lastTrackingQualityRef.current = null;
        lastConfidenceTierRef.current = null;
        repIndexTrackerRef.current.reset();
        resetWorkoutController({ preserveRepCount: true });
        lastMetricsPublishRef.current = null;
        setActiveMetrics(null);
        setLivePullupPartialStatus(null);
        lastLivePartialBadgeRef.current = null;
        activePhaseRef.current = activeWorkoutDef.initialPhase;
        transitionPhase(activeWorkoutDef.initialPhase);
      }
    } catch (error) {
      errorWithTs('[ScanARKit] ❌ Error calculating angles:', error);
    } finally {
      if (frameProcessStartMs !== null) {
        recordFrameLatency(baselineDebugMetricsRef.current, Math.max(0, nowMs() - frameProcessStartMs));
      }
    }

    frameStatsRef.current.frameCount += 1;
    if (frameStatsRef.current.lastTimestamp === 0) {
      frameStatsRef.current.lastTimestamp = pose.timestamp;
      lastFpsPublishMsRef.current = Date.now();
      return;
    }

    // Publish FPS on a fixed 500ms wall-clock cadence instead of
    // per-frame. Still use the pose timestamp delta to compute the rate so
    // the reported number reflects actual frame arrival (not clock skew).
    const nowWall = Date.now();
    if (nowWall - lastFpsPublishMsRef.current >= FPS_PUBLISH_INTERVAL_MS) {
      const elapsed = pose.timestamp - frameStatsRef.current.lastTimestamp;
      if (elapsed > 0) {
        const newFps = Math.round(frameStatsRef.current.frameCount / elapsed);
        if (baselineDebugEnabledRef.current) {
          logWithTs('[ScanARKit] 🎯 Performance:', {
            fps: newFps,
            totalFrames: frameStatsRef.current.frameCount
          });
        }
        setFps(newFps);
        fpsStatsRef.current.count += 1;
        fpsStatsRef.current.sum += newFps;
        fpsStatsRef.current.min = Math.min(fpsStatsRef.current.min, newFps);
        frameStatsRef.current = { lastTimestamp: pose.timestamp, frameCount: 0 };
      }
      lastFpsPublishMsRef.current = nowWall;
    }
  // Intentionally scoped to frame-driven inputs to avoid hot-path dependency churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, transitionPhase, detectionMode, activeWorkoutDef, processWorkoutFrame, resetWorkoutController, resetCueHysteresis]);

  // Debug pose2D updates
  useEffect(() => {
    if (pose2D && baselineDebugEnabledRef.current) {
      logWithTs('[ScanARKit] 📍 pose2D update:', {
        joints: pose2D.joints.length,
        tracked: pose2D.joints.filter(j => j.isTracked).length,
        isTracking: pose2D.isTracking
      });
    }
  }, [baselineDebugEnabledRef, pose2D]);

  return {

  };
}

export type ScanPoseFramesCtx = ScanModeAndPlaybackCtx & ReturnType<typeof useScanPoseFrames>;

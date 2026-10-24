import { Platform, Alert } from 'react-native';
import React, { useCallback, useEffect, useRef } from 'react';
import { captureWatchMirrorOverlay } from '@/lib/watch-connectivity/mirror-overlay';
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
import { sendMessage, getIsPaired, getIsWatchAppInstalled, getReachability, watchEvents, updateWatchContext } from '@/lib/watch-connectivity';
import { warnWithTs } from '@/lib/logger';
import { buildWatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';
import { planWatchTrackingPublication } from '@/lib/watch-connectivity/tracking-publication';
import { WATCH_MIRROR_MAX_WIDTH, WATCH_MIRROR_AR_QUALITY, WATCH_MIRROR_INTERVAL_MS } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanCuesAndExitCtx } from '@/features/form-tracking/hooks/scan/use-scan-cues-and-exit';

export function useScanWatchMirror(ctx: ScanCuesAndExitCtx) {
  const {
    DEV, activeMetrics, activePhase, activeWorkoutDef, appStatePause, cameraPosition,
    detectionMode, isScreenFocused, isTracking, lastTrackingQualityRef, livePullupPartialStatus,
    logTrackingDebug, overlayLayout, primaryCue, repCount, setWatchInstalled,
    setWatchMirrorEnabled, setWatchPaired, setWatchReachable, startTracking, stopTracking,
    supportStatus, watchInstalled, watchMirrorEnabled, watchMirrorPublisher, watchMirrorSvgRef,
    watchMirrorTimerRef, watchPaired, watchReachable, watchTrackingPublicationRef,
  } = ctx;

    // The watch-mirror timer polls BodyTracker.getCurrentFrameSnapshot()
    // up to 10Hz while tracking. Previously it only checked `isTracking`, so when
    // useAppStatePause flipped `isPaused=true` on background/inactive (phone
    // lock, Control Center, incoming call) the poll kept firing, burning
    // battery AND keeping the ARKit session half-alive. Gate the whole
    // mirror surface on BOTH `isTracking` AND `!appStatePause.isPaused` so
    // the timer teardown fires the moment the app backgrounds. #575 item #9.
    const canMirrorFromArkit =
      Platform.OS === 'ios' &&
      watchMirrorEnabled &&
      isScreenFocused &&
      isTracking &&
      !appStatePause.isPaused &&
      cameraPosition === 'back';
    const watchMirrorActive =
      canMirrorFromArkit &&
      watchPaired &&
      watchInstalled &&
      watchReachable;
    const watchReady = watchPaired && watchInstalled;
    const handleWatchMirrorToggle = useCallback(
      (value: boolean) => {
        if (!watchReady) {
          Alert.alert('Watch not ready', 'Pair your Apple Watch and install the watch app first.');
          return;
        }
        if (!value) watchMirrorPublisher.setActive(false);
        setWatchMirrorEnabled(value);
      },
      [watchReady, watchMirrorPublisher, setWatchMirrorEnabled]
    );

    const captureAndSendWatchMirror = useCallback(async () => {
      try {
        await watchMirrorPublisher.publish(async () => {
          if (!canMirrorFromArkit) return null;
          const viewport = overlayLayout.current;
          if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
          const overlay = await captureWatchMirrorOverlay(watchMirrorSvgRef.current, viewport, WATCH_MIRROR_MAX_WIDTH);
          const snapshot = await BodyTracker.getCurrentFrameSnapshot({
            maxWidth: WATCH_MIRROR_MAX_WIDTH,
            quality: WATCH_MIRROR_AR_QUALITY,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            overlay,
          });
          if (!snapshot?.frame) return null;
          logTrackingDebug('watch-mirror-orientation', {
            ts: Date.now(),
            canMirrorFromArkit: true,
            hasFrame: true,
            orientation: snapshot.orientation ?? null,
            mirrored: snapshot.mirrored ?? null,
            cameraPosition,
          });
          return { ...snapshot, cameraPosition };
        }, sendMessage);
      } catch (error) {
        if (DEV) warnWithTs('[ScanARKit] Watch mirror snapshot failed', error);
      }
    }, [watchMirrorPublisher, canMirrorFromArkit, overlayLayout, watchMirrorSvgRef, logTrackingDebug, cameraPosition, DEV]);

    useEffect(() => {
      if (Platform.OS !== 'ios') {
        return;
      }

      let isMounted = true;

      const refreshWatchStatus = async () => {
        try {
          const [paired, installed, reachable] = await Promise.all([
            getIsPaired(),
            getIsWatchAppInstalled(),
            getReachability(),
          ]);
          if (!isMounted) return;
          setWatchPaired(!!paired);
          setWatchInstalled(!!installed);
          setWatchReachable(!!reachable);
        } catch (error) {
          if (DEV) warnWithTs('[ScanARKit] Watch status check failed', error);
        }
      };

      refreshWatchStatus();

      const unsubscribeReach = watchEvents.addListener('reachability', (reachable: boolean) => {
        setWatchReachable(!!reachable);
      });
      const unsubscribePaired = watchEvents.addListener('paired', (paired: boolean) => {
        setWatchPaired(!!paired);
      });
      const unsubscribeInstalled = watchEvents.addListener('installed', (installed: boolean) => {
        setWatchInstalled(!!installed);
      });

      return () => {
        isMounted = false;
        unsubscribeReach();
        unsubscribePaired();
        unsubscribeInstalled();
      };
    }, [DEV, setWatchInstalled, setWatchPaired, setWatchReachable]);

    // Exercise changes invalidate captures of the previous exercise's overlay.
    React.useLayoutEffect(() => {
      watchMirrorPublisher.setActive(watchMirrorActive);
      if (!watchMirrorActive) {
        if (watchMirrorTimerRef.current) {
          clearInterval(watchMirrorTimerRef.current);
          watchMirrorTimerRef.current = null;
        }
        return;
      }

      const tick = () => {
        // Setup/rest is when the user checks framing from the Watch.
        captureAndSendWatchMirror();
      };

      tick();
      watchMirrorTimerRef.current = setInterval(tick, WATCH_MIRROR_INTERVAL_MS);

      return () => {
        watchMirrorPublisher.setActive(false);
        if (watchMirrorTimerRef.current) {
          clearInterval(watchMirrorTimerRef.current);
          watchMirrorTimerRef.current = null;
        }
      };
    }, [watchMirrorActive, captureAndSendWatchMirror, watchMirrorPublisher, detectionMode, watchMirrorTimerRef]);

    // Watch Connectivity: Listen for commands
    //
    // The watch channel is asynchronous: a user can tap "start" on the
    // watch, foreground-background the phone, and the message still
    // arrives ~1s later. Without a focus + latest-ref guard the handler
    // would call startTracking()/stopTracking() closures captured at the
    // time the effect ran, which may reference stale props (for example
    // isTracking=false even though tracking already started via a
    // concurrent tap on the phone). Reading from refs at call time keeps
    // the decision based on current state, and the isScreenFocused check
    // prevents late messages arriving after the user navigated away from
    // the scan tab from kicking the camera back on.
    const isTrackingRef = useRef(isTracking);
    const supportStatusRef = useRef(supportStatus);
    const isScreenFocusedRef = useRef(isScreenFocused);
    useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);
    useEffect(() => { supportStatusRef.current = supportStatus; }, [supportStatus]);
    useEffect(() => { isScreenFocusedRef.current = isScreenFocused; }, [isScreenFocused]);

    useEffect(() => {
      const unsubscribe = watchEvents.addListener('message', (message: { command?: string }) => {
        // Ignore late messages arriving after the screen unfocused /
        // unmounted; see the comment block above for rationale.
        if (!isScreenFocusedRef.current) {
          return;
        }
        if (message.command === 'start') {
          if (!isTrackingRef.current && supportStatusRef.current === 'supported') {
            startTracking();
          }
        } else if (message.command === 'stop') {
          if (isTrackingRef.current) {
            stopTracking();
          }
        }
      });

      return () => unsubscribe();
    }, [startTracking, stopTracking]);

    // Watch Connectivity: Sync state
    useEffect(() => {
      // Scope invalidation: do not dedupe a newly focused/available scan or
      // exercise against the previous one. Keep timestamp ordering across
      // scopes. No retained snapshot or trailing callback survives cleanup.
      return () => {
        watchTrackingPublicationRef.current = { ...watchTrackingPublicationRef.current, lastSubmission: null };
      };
    }, [detectionMode, isScreenFocused, watchInstalled, watchPaired, watchTrackingPublicationRef]);

    useEffect(() => {
      if (Platform.OS !== 'ios' || !isScreenFocused) {
        return;
      }
      if (!watchPaired || !watchInstalled) {
        return;
      }

      const now = Date.now();

      const reps = repCount;
      const phase = activePhase;
      const metrics = activeWorkoutDef.ui?.buildWatchMetrics(activeMetrics as never) ?? {};
      const confidence = lastTrackingQualityRef.current;
      const partialBadge = livePullupPartialStatus?.visibility_badge;
      const isDegraded = partialBadge != null && partialBadge !== 'full';
      const quality =
        typeof confidence === 'number'
          ? { trackingConfidence: confidence, isDegraded, degradationReason: isDegraded ? partialBadge : undefined }
          : undefined;

      const snapshot = buildWatchTrackingPayload({
        now,
        isTracking: !!isTracking,
        mode: detectionMode,
        phase,
        reps,
        primaryCue: primaryCue ?? null,
        metrics,
        quality,
      });

      const { state, payload } = planWatchTrackingPublication(watchTrackingPublicationRef.current, snapshot);
      watchTrackingPublicationRef.current = state;
      if (!payload) return;

      // Local submissions only, not delivery acknowledgements. In particular,
      // application context must still be submitted when the Watch is unreachable.
      sendMessage(payload);
      updateWatchContext(payload);
	    }, [activePhase, activeMetrics, activeWorkoutDef, detectionMode, isScreenFocused, isTracking, livePullupPartialStatus, primaryCue, repCount, watchInstalled, watchPaired, lastTrackingQualityRef, watchTrackingPublicationRef]);

  return {
    watchReady, handleWatchMirrorToggle,
  };
}

export type ScanWatchMirrorCtx = ScanCuesAndExitCtx & ReturnType<typeof useScanWatchMirror>;

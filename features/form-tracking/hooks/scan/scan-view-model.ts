import { getWorkoutByMode } from '@/lib/workouts';
import { classifyCue } from '@/features/form-tracking/components/CueCard';
import { formatMetricValue, getMetricValue, formatDuration, QUALITY_LABELS } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanActionsCtx } from '@/features/form-tracking/hooks/scan/use-scan-actions';

/** Render-only values derived from the scan screen state. Not a hook: runs after early returns. */
export function buildScanView(ctx: ScanActionsCtx) {
  const {
    activeMetrics, activePhase, activeWorkoutDef, baselineDebugMetricsRef, detectionMode,
    fixturePlaybackEnabled, isTracking, latestPullupScoring, livePullupPartialStatus, primaryCue,
    recordPreview, repCount, showPartialTrackingBadge,
  } = ctx;

  const telemetryReps = repCount;
  const showTelemetry = isTracking || fixturePlaybackEnabled || telemetryReps > 0;
	  const telemetryTitle = `${activeWorkoutDef.displayName} Tracker`;
	  const telemetryPhaseId = activePhase;
	  const telemetryPhaseLabel =
	    activeWorkoutDef.phases.find((phase) => phase.id === telemetryPhaseId)?.displayName ??
	    String(telemetryPhaseId);
	  const telemetryUi = activeWorkoutDef.ui;
	  const telemetryMetricValues = telemetryUi?.buildWatchMetrics(activeMetrics as never) ?? {};
	  const telemetryPrimaryMetric = telemetryUi?.primaryMetric;
	  const telemetrySecondaryMetric = telemetryUi?.secondaryMetric;
	  const telemetryPrimaryLabel = telemetryPrimaryMetric?.label ?? '--';
	  const telemetryPrimaryDisplay = telemetryPrimaryMetric
	    ? formatMetricValue(
	        telemetryPrimaryMetric.format,
	        getMetricValue(telemetryMetricValues, telemetryPrimaryMetric.key)
	      )
	    : '--';
	  const telemetrySecondaryLabel = telemetrySecondaryMetric?.label ?? '--';
	  const telemetrySecondaryDisplay = telemetrySecondaryMetric
	    ? formatMetricValue(
	        telemetrySecondaryMetric.format,
	        getMetricValue(telemetryMetricValues, telemetrySecondaryMetric.key)
	      )
	    : '--';
	  const previewMetrics = recordPreview?.metrics;
	  const previewReps = previewMetrics?.reps ?? 0;
	  const previewUi = previewMetrics ? getWorkoutByMode(previewMetrics.mode).ui : undefined;
	  const previewPrimaryMetric = previewUi?.primaryMetric;
	  const previewSecondaryMetric = previewUi?.secondaryMetric;
	  const previewPrimaryLabel = previewPrimaryMetric?.label ?? '--';
	  const previewPrimaryDisplay =
	    previewMetrics && previewPrimaryMetric
	      ? formatMetricValue(previewPrimaryMetric.format, getMetricValue(previewMetrics, previewPrimaryMetric.key))
	      : '--';
	  const previewSecondary = {
	    label: previewSecondaryMetric?.label ?? '--',
	    display:
	      previewMetrics && previewSecondaryMetric
	        ? formatMetricValue(previewSecondaryMetric.format, getMetricValue(previewMetrics, previewSecondaryMetric.key))
	        : '--',
	  };
	  const previewFormScore = previewMetrics?.avgFqi != null ? `${Math.round(previewMetrics.avgFqi)}` : '--';
	  const previewDuration = formatDuration(previewMetrics?.recordingStartAt, previewMetrics?.recordingEndAt);
	  const previewQuality = previewMetrics?.recordingQuality ? QUALITY_LABELS[previewMetrics.recordingQuality] : '--';
  const effectivePartialStatus =
    isTracking || fixturePlaybackEnabled
      ? livePullupPartialStatus ?? latestPullupScoring
      : latestPullupScoring;
  const shouldShowPartialTrackingBadge =
    detectionMode === 'pullup' &&
    (isTracking || fixturePlaybackEnabled) &&
    showPartialTrackingBadge;
  const shouldShowTrackingLossBanner = shouldShowPartialTrackingBadge;
  const liveCue = primaryCue ? classifyCue(primaryCue) : null;
  const showReadinessGuide = !isTracking;
  const baselineMetricsSnapshot = baselineDebugMetricsRef.current;
  const debugCueFlipRate =
    baselineMetricsSnapshot.cueSamples > 0
      ? baselineMetricsSnapshot.cueFlipCount / baselineMetricsSnapshot.cueSamples
      : 0;
  const debugMeanFrameLatencyMs =
    baselineMetricsSnapshot.frameLatencyCount > 0
      ? baselineMetricsSnapshot.frameLatencyTotalMs / baselineMetricsSnapshot.frameLatencyCount
      : 0;

  return {
    telemetryReps, showTelemetry, telemetryTitle, telemetryPhaseLabel, telemetryPrimaryLabel,
    telemetryPrimaryDisplay, telemetrySecondaryLabel, telemetrySecondaryDisplay, previewReps,
    previewPrimaryLabel, previewPrimaryDisplay, previewSecondary, previewFormScore,
    previewDuration, previewQuality, effectivePartialStatus, shouldShowTrackingLossBanner,
    liveCue, showReadinessGuide, baselineMetricsSnapshot, debugCueFlipRate,
    debugMeanFrameLatencyMs,
  };
}

export type ScanViewCtx = ScanActionsCtx & ReturnType<typeof buildScanView>;

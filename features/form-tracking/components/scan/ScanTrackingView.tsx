import { View, Text } from 'react-native';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import FqiGauge from '@/features/form-tracking/components/FqiGauge';
import TrackingLossBanner from '@/features/form-tracking/components/TrackingLossBanner';
import { Ionicons } from '@expo/vector-icons';
import CueCard from '@/features/form-tracking/components/CueCard';
import { ARKitView } from '@/features/form-tracking/hooks/scan/scan-constants';
import { scanArV2Styles } from '@/features/form-tracking/components/scan/ArScanOverlays';
import type { ScanViewCtx } from '@/features/form-tracking/hooks/scan/scan-view-model';
import { ScanCameraOverlay } from '@/features/form-tracking/components/scan/ScanCameraOverlay';

export function ScanTrackingView({ ctx }: { ctx: ScanViewCtx }) {
  const {
    cameraPosition, handleCheckLighting, handleDismissPartialTrackingBanner,
    handleReacquireSubject, isTracking, latestFqiScore, liveCue, shouldShowTrackingLossBanner,
    showTelemetry, telemetryPhaseLabel, telemetryPrimaryDisplay, telemetryPrimaryLabel,
    telemetryReps, telemetrySecondaryDisplay, telemetrySecondaryLabel, telemetryTitle,
    topBarBottom, trackingRecoveredPulseId,
  } = ctx;
  return (
    <>
      {/* Tracking view */}
      <View style={styles.trackingContainer}>
        {/* ARKitView - always mount when back camera is selected (hidden when not tracking) so it's ready */}
        {cameraPosition === 'back' && (
          <ARKitView
            key={`arkit-${cameraPosition}`}
            style={[
              styles.fullFill,
              !isTracking && { opacity: 0, pointerEvents: 'none' }
            ]}
            pointerEvents={isTracking ? "box-none" : "none"}
          />
        )}

        <ScanCameraOverlay ctx={ctx} />

	        {/* Workout telemetry display */}
	        {showTelemetry && (
          <View style={[styles.anglesDisplay, { top: topBarBottom + 8 }]}>
	            <Text style={styles.anglesTitle}>{telemetryTitle}</Text>
	            <View style={styles.anglesGrid}>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Reps</Text>
                <Text style={styles.angleValue}>{telemetryReps}</Text>
              </View>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Phase</Text>
                <Text style={styles.angleValue}>{telemetryPhaseLabel}</Text>
              </View>
	              <View style={styles.angleItem}>
	                <Text style={styles.angleLabel}>{telemetryPrimaryLabel}</Text>
	                <Text style={styles.angleValue}>{telemetryPrimaryDisplay}</Text>
	              </View>
	              <View style={styles.angleItem}>
	                <Text style={styles.angleLabel}>{telemetrySecondaryLabel}</Text>
	                <Text style={styles.angleValue}>{telemetrySecondaryDisplay}</Text>
	              </View>
	            </View>
	          </View>
	        )}

        {isTracking ? (
          <>
            <View style={[styles.fqiGaugeSlot, { top: topBarBottom + 8 }]}>
              <FqiGauge
                score={latestFqiScore}
                size="sm"
                accessibilityLabel={latestFqiScore === null ? 'Live form quality not measured yet' : `Live form quality ${Math.round(latestFqiScore)} out of 100`}
                testID="scan-live-fqi-gauge"
              />
            </View>
            <View style={[styles.trackingLossSlot, { top: topBarBottom + 82 }]}>
              <TrackingLossBanner
                visible={shouldShowTrackingLossBanner}
                lostForMs={null}
                title="Partial tracking"
                subtitle="Step fully into frame so the next rep scores cleanly."
                onDismiss={handleDismissPartialTrackingBanner}
                onRecalibrate={handleReacquireSubject}
                onCheckLighting={handleCheckLighting}
              />
            </View>
            {trackingRecoveredPulseId !== null ? (
              <View
                key={`tracking-recovered-${trackingRecoveredPulseId}`}
                style={[scanArV2Styles.recoveredPulse, { top: topBarBottom + 138 }]}
                accessibilityRole="alert"
                accessibilityLabel="Tracking recovered"
              >
                <Ionicons name="checkmark-circle" size={16} color="#0B1F3A" />
                <Text style={scanArV2Styles.recoveredPulseText}>Tracking recovered</Text>
              </View>
            ) : null}
            <View style={styles.feedbackContainer}>
              <CueCard cue={liveCue} testID="scan-live-cue-card" />
            </View>
          </>
        ) : null}
      </View>
    </>
  );
}

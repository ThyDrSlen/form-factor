import { View, Animated, Text, TouchableOpacity } from 'react-native';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import { Svg, Rect, Circle, Line } from 'react-native-svg';
import ExerciseCameraGuide from '@/features/form-tracking/components/ExerciseCameraGuide';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonOverlay } from '@/features/form-tracking/components/SkeletonOverlay';
import { ARScanOverlaysV2, scanArV2Styles } from '@/features/form-tracking/components/scan/ArScanOverlays';
import type { ScanViewCtx } from '@/features/form-tracking/hooks/scan/scan-view-model';

export function ScanCameraOverlay({ ctx }: { ctx: ScanViewCtx }) {
  const {
    DEV, activeFormTargets, activePhase, adaptiveFps, appStatePause, cameraPermission,
    cameraPosition, detectionMode, dismissSustainedOcclusion, dismissUploadRetry,
    effectivePartialStatus, handleOverlayLayout, handlePreSetPreviewCheck, isTracking,
    jointAngles, overlayLayout, pose, pose2D, retryUploadRecordedVideo, setShowCameraGuide,
    showCameraGuide, showReadinessGuide, showTelemetry, smoothedPose2DJoints, smoothedPose2DRef,
    subjectIdentity, sustainedOcclusionHint, textOpacity, topBarBottom, uploadRetryPayload,
    uploading, watchMirrorSvgRef,
  } = ctx;
  return (
    <>
      {/* Overlay guides */}
      <View
        style={[styles.overlay, { zIndex: 100 }]}
        pointerEvents={isTracking ? 'none' : 'auto'}
        onStartShouldSetResponder={() => false}
        onLayout={handleOverlayLayout}
      >

        {/*
          Overlay-alignment diagnostic (dev only). If corner dots don't
          sit at the actual screen corners and the border doesn't trace
          the visible camera rect, the SVG container is not the same
          rect as the native ARView — that's the overlay misalignment bug.
        */}
        {DEV && (
          <Svg
            style={styles.fullFill}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            pointerEvents="none"
          >
            <Rect x="0" y="0" width="1" height="1" fill="none" stroke="#FF00FF" strokeWidth="0.004" />
            <Circle cx="0" cy="0" r="0.012" fill="#FF00FF" />
            <Circle cx="1" cy="0" r="0.012" fill="#FF00FF" />
            <Circle cx="0" cy="1" r="0.012" fill="#FF00FF" />
            <Circle cx="1" cy="1" r="0.012" fill="#FF00FF" />
            <Line x1="0.45" y1="0.5" x2="0.55" y2="0.5" stroke="#FFFF00" strokeWidth="0.004" />
            <Line x1="0.5" y1="0.45" x2="0.5" y2="0.55" stroke="#FFFF00" strokeWidth="0.004" />
            <Circle cx="0.5" cy="0.5" r="0.006" fill="#FFFF00" />
            <Line x1="0.25" y1="0.48" x2="0.25" y2="0.52" stroke="#00FFFF" strokeWidth="0.003" />
            <Line x1="0.75" y1="0.48" x2="0.75" y2="0.52" stroke="#00FFFF" strokeWidth="0.003" />
            <Line x1="0.48" y1="0.25" x2="0.52" y2="0.25" stroke="#00FFFF" strokeWidth="0.003" />
            <Line x1="0.48" y1="0.75" x2="0.52" y2="0.75" stroke="#00FFFF" strokeWidth="0.003" />
          </Svg>
        )}

        {!showTelemetry && (
          <Animated.View style={[styles.topGuide, { top: topBarBottom + 16, opacity: textOpacity }]}>
            <Text style={styles.guideText}>
              {isTracking ? 'Tracking Active' : 'Ready when you are'}
            </Text>
            <Text style={styles.guideSubtext}>
              Tap Record Set once — we’ll start the camera, wait for your skeleton, then record.
            </Text>
            {pose && (
              <View style={styles.qualityIndicator}>
                <View style={styles.qualityBar} />
              </View>
            )}
          </Animated.View>
        )}

        {showReadinessGuide ? (
          <View style={[styles.onboardingSlot, { top: topBarBottom + 92 }]}>
            {showCameraGuide ? (
              <ExerciseCameraGuide
                exerciseKey={detectionMode}
                style={styles.cameraGuideCard}
                onDismiss={() => setShowCameraGuide(false)}
              />
            ) : null}
            <View style={styles.readinessCard}>
              <Text style={styles.readinessEyebrow}>Before you record</Text>
              <Text style={styles.readinessTitle}>Record handles camera startup.</Text>
              <Text style={styles.readinessBody}>
                Tap Record Set once. We’ll bring the camera online, wait for your skeleton, then begin recording without making you tap Start Camera first.
              </Text>
              <TouchableOpacity
                style={styles.readinessAction}
                onPress={handlePreSetPreviewCheck}
                accessibilityRole="button"
                accessibilityLabel="Check stance"
              >
                <Ionicons name="sparkles-outline" size={14} color="#0B1F3A" />
                <Text style={styles.readinessActionText}>Check stance</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Skeleton Overlay (2D projected) */}
        <SkeletonOverlay
          ref={watchMirrorSvgRef}
          pose={pose2D}
          enabled={isTracking && cameraPosition === 'back'}
          mode={detectionMode}
          missingComponents={effectivePartialStatus?.missing_components}
          style={styles.fullFill}
        />

        {/* AR overlays (#445): resilience UX + SVG joint overlays. */}
        {isTracking && cameraPosition === 'back' && overlayLayout.current && smoothedPose2DJoints && smoothedPose2DJoints.length > 0 ? (
          <ARScanOverlaysV2
            joints={smoothedPose2DRef.current ?? smoothedPose2DJoints}
            width={overlayLayout.current.width}
            height={overlayLayout.current.height}
            angles={jointAngles}
            activeFormTargets={activeFormTargets}
            activePhase={activePhase}
          />
        ) : null}

        {/* Subject-identity switch banner */}
        {subjectIdentity.snapshot.switchDetected ? (
          <View style={scanArV2Styles.banner} accessibilityRole="alert">
            <Ionicons name="person-circle-outline" size={18} color="#FDE047" />
            <Text style={scanArV2Styles.bannerText}>
              Subject changed — step back into frame
            </Text>
            <TouchableOpacity
              onPress={subjectIdentity.recalibrate}
              style={scanArV2Styles.bannerAction}
              accessibilityRole="button"
              accessibilityLabel="Reset subject tracking"
            >
              <Text style={scanArV2Styles.bannerActionText}>Reset</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Camera-permission revoked banner */}
        {cameraPermission.revoked ? (
          <View
            style={[scanArV2Styles.banner, scanArV2Styles.bannerError]}
            accessibilityRole="alert"
          >
            <Ionicons name="videocam-off-outline" size={18} color="#FCA5A5" />
            <Text style={scanArV2Styles.bannerText}>
              Camera access disabled
            </Text>
            <TouchableOpacity
              onPress={() => {
                void cameraPermission.openSettings();
              }}
              style={scanArV2Styles.bannerAction}
              accessibilityRole="button"
              accessibilityLabel="Open Settings to re-enable camera"
            >
              <Text style={scanArV2Styles.bannerActionText}>Settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Resume? prompt after AppState foreground return */}
        {appStatePause.needsResume ? (
          <View
            style={[scanArV2Styles.banner, scanArV2Styles.bannerInfo]}
            accessibilityRole="alert"
          >
            <Ionicons name="pause-circle-outline" size={18} color="#93C5FD" />
            <Text style={scanArV2Styles.bannerText}>
              Paused — resume tracking?
            </Text>
            <TouchableOpacity
              onPress={appStatePause.resume}
              style={scanArV2Styles.bannerAction}
              accessibilityRole="button"
              accessibilityLabel="Resume tracking"
            >
              <Text style={scanArV2Styles.bannerActionText}>Resume</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/*
         * Video-upload retry banner (#551).
         *
         * When uploadRecordedVideo rejects, the try-catch already fires
         * an Alert and sets previewError, but the user loses the
         * affordance once they dismiss the Alert and close the preview.
         * This banner persists with a Retry pill that re-invokes the
         * upload using the stored URI — no re-encoding, no re-navigate.
         */}
        {uploadRetryPayload ? (
          <View
            style={[scanArV2Styles.banner, scanArV2Styles.bannerError]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="scan-arkit-upload-retry-banner"
          >
            <Ionicons name="cloud-offline-outline" size={18} color="#FCA5A5" />
            <Text style={scanArV2Styles.bannerText}>
              Upload failed — {uploadRetryPayload.message}
            </Text>
            <TouchableOpacity
              onPress={retryUploadRecordedVideo}
              style={scanArV2Styles.bannerAction}
              accessibilityRole="button"
              accessibilityLabel="Retry video upload"
              disabled={uploading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="scan-arkit-upload-retry-button"
            >
              <Text style={scanArV2Styles.bannerActionText}>
                {uploading ? 'Retrying…' : 'Retry'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={dismissUploadRetry}
              accessibilityRole="button"
              accessibilityLabel="Dismiss upload retry banner"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={scanArV2Styles.bannerDismiss}
              testID="scan-arkit-upload-retry-dismiss"
            >
              <Ionicons name="close" size={14} color="#F5F7FF" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/*
         * Persistent sustained-occlusion banner (#551).
         *
         * Replaces the 3.2s micro-toast. The banner sticks until the
         * user taps "Got it" or the OcclusionHoldManager clears the
         * sustained state by calling handleSustainedOcclusion(null).
         * A dismiss button is essential — on long-limb occlusion (e.g.
         * squat with arms crossed over camera) the old toast faded
         * before the user could read what joint was hidden.
         */}
        {sustainedOcclusionHint ? (
          <View
            style={[scanArV2Styles.banner, scanArV2Styles.bannerError]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="scan-arkit-sustained-occlusion-banner"
          >
            <Ionicons name="eye-off-outline" size={14} color="#F5F7FF" />
            <Text
              style={scanArV2Styles.microToastText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Adjust clothing —{' '}
              {sustainedOcclusionHint.jointNames.slice(0, 3).join(', ')} hidden
            </Text>
            {sustainedOcclusionHint.jointNames.length > 3 ? (
              <Text
                style={scanArV2Styles.microToastText}
                numberOfLines={1}
              >
                +{sustainedOcclusionHint.jointNames.length - 3} more
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={dismissSustainedOcclusion}
              accessibilityRole="button"
              accessibilityLabel="Dismiss occlusion warning"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={scanArV2Styles.bannerDismiss}
              testID="scan-arkit-sustained-occlusion-dismiss"
            >
              <Ionicons name="close" size={14} color="#F5F7FF" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Thermal/FPS debug badge (DEV-only) */}
        {DEV && adaptiveFps.throttled ? (
          <View style={scanArV2Styles.fpsBadge}>
            <Text style={scanArV2Styles.fpsBadgeText}>
              {adaptiveFps.fps}fps · {adaptiveFps.state}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

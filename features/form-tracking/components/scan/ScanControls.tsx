import { View, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import type { RecordingQuality } from '@/lib/services/video-metrics';
import { Ionicons } from '@expo/vector-icons';
import { PRCelebrationBadge } from '@/features/form-tracking/components/PRCelebrationBadge';
import { ProgressionSuggestionBadge } from '@/features/form-tracking/components/ProgressionSuggestionBadge';
import { QUALITY_LABELS } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanViewCtx } from '@/features/form-tracking/hooks/scan/scan-view-model';

export function ScanControls({ ctx }: { ctx: ScanViewCtx }) {
  const {
    baselineDebugEnabled, baselineMetricsSnapshot, clearCurrentPR, currentPR, debugCueFlipRate,
    debugMeanFrameLatencyMs, fixtureFrames, fixtureName, fixturePlaybackEnabled,
    fixturePlaybackFramesProcessed, fps, handleRecordSetPress, insets, isFinalizingRecording,
    isRecording, isTracking, pose, progressionSuggestion, recordingQuality, recordingStartStatus,
    showDebugStats, topBarBottom, updateRecordingQuality,
  } = ctx;
  return (
    <>
      {/* Controls */}
      <View style={[styles.controls, { bottom: insets.bottom + 24 }]}>
        <View style={styles.recordingQualityDock}>
          <View style={styles.recordingQualityHeader}>
            <Text style={styles.recordingQualityLabel}>Recording quality</Text>
            <Text style={styles.recordingQualityHint}>
              {recordingQuality === 'high'
                ? 'High detail · larger clips'
                : recordingQuality === 'low'
                  ? 'Small clips · less detail'
                  : 'Balanced detail + size'}
            </Text>
          </View>
          <View style={styles.qualityButtons}>
            {(['low', 'medium', 'high'] as RecordingQuality[]).map((quality) => (
              <TouchableOpacity
                key={quality}
                style={[
                  styles.qualityButton,
                  recordingQuality === quality && styles.qualityButtonActive,
                  (isRecording || isFinalizingRecording) && styles.qualityButtonDisabled,
                ]}
                onPress={() => updateRecordingQuality(quality)}
                disabled={isRecording || isFinalizingRecording}
                accessibilityRole="button"
                accessibilityLabel={`Set recording quality to ${QUALITY_LABELS[quality]}`}
              >
                <Text style={[
                  styles.qualityButtonText,
                  recordingQuality === quality && styles.qualityButtonTextActive,
                ]}>
                  {QUALITY_LABELS[quality]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.controlButton,
            styles.recordButton,
            isRecording && styles.recordButtonActive,
            isFinalizingRecording && styles.recordButtonDisabled,
          ]}
          onPress={handleRecordSetPress}
          disabled={isFinalizingRecording}
          accessibilityRole="button"
          accessibilityLabel={isRecording ? 'Stop recording' : 'Record set'}
        >
          {isFinalizingRecording || recordingStartStatus !== 'idle' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons
              name={isRecording ? 'stop-circle' : 'radio-button-on'}
              size={isRecording ? 22 : 20}
              color="#FFFFFF"
            />
          )}
          <Text style={styles.controlButtonText}>
            {isFinalizingRecording
              ? 'Finalizing...'
              : isRecording
                ? 'Stop Recording'
                : recordingStartStatus === 'starting-camera'
                  ? 'Starting Camera...'
                  : recordingStartStatus === 'waiting-for-skeleton'
                    ? 'Step Into Frame...'
                    : 'Record Set'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status badge */}
      {showDebugStats && (
        <View style={[styles.statusBadge, { top: topBarBottom + 8 }]}> 
          <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
          <View>
            <Text style={styles.statusText}>
              {fixturePlaybackEnabled
                ? `Fixture Playback (${fixtureName}) • ${fixturePlaybackFramesProcessed}/${fixtureFrames?.length ?? 0} frames`
                : `${isTracking ? 'Tracking' : 'Inactive'} • ${pose?.joints.length || 0} joints • ${fps} FPS`}
            </Text>
            <Text style={styles.statusSubtext}>
              {Platform.OS === 'ios' ? 'GPU: Metal' : Platform.OS === 'android' ? 'GPU: OpenGL/Vulkan' : 'GPU: WebGL'}
            </Text>
            {baselineDebugEnabled && (
              <Text style={styles.statusSubtext}>
                {`cueFlipRate=${(debugCueFlipRate * 100).toFixed(1)}% meanFrameLatency=${debugMeanFrameLatencyMs.toFixed(2)}ms buckets[<4:${baselineMetricsSnapshot.latencyBuckets.lt4} <8:${baselineMetricsSnapshot.latencyBuckets.lt8} <16:${baselineMetricsSnapshot.latencyBuckets.lt16} >=16:${baselineMetricsSnapshot.latencyBuckets.gte16}]`}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* PR celebration badge (issue #447 W3-C #2). Surgical mount — renders
          only when usePRDetection has a hit. Safe no-op when pr is null. */}
      <PRCelebrationBadge pr={currentPR} onDismiss={clearCurrentPR} />

      {/* Progression suggestion badge (issue #447 W3-C #3). Hidden until the
          data-feed wiring lands (see TODO near useProgressionSuggestion). */}
      {progressionSuggestion ? (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <ProgressionSuggestionBadge suggestion={progressionSuggestion} />
        </View>
      ) : null}
    </>
  );
}

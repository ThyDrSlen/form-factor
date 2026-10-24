import { Modal, View, TouchableOpacity, Text, Switch, Platform } from 'react-native';
import { styles } from '@/features/form-tracking/styles/_scan-arkit.styles';
import { Ionicons } from '@expo/vector-icons';
import type { RecordingQuality } from '@/lib/services/video-metrics';
import { QUALITY_LABELS } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanViewCtx } from '@/features/form-tracking/hooks/scan/scan-view-model';

export function ScanSettingsModal({ ctx }: { ctx: ScanViewCtx }) {
  const {
    audioFeedbackEnabled, gestureRecordingEnabled, handleReacquireSubject,
    handleWatchMirrorToggle, insets, isFinalizingRecording, isRecording, isSettingsVisible,
    recordingQuality, router, setAudioFeedbackEnabled, setGestureRecordingEnabled,
    setIsSettingsVisible, setShadowModeEnabled, setShowDebugStats, setSubjectLockEnabled,
    shadowModeEnabled, showDebugStats, subjectLockEnabled, updateRecordingQuality,
    watchMirrorEnabled, watchReady,
  } = ctx;
  return (
    <>
      <Modal
        visible={isSettingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsSettingsVisible(false)}
      >
        <View style={styles.settingsOverlay}>
          <TouchableOpacity
            style={styles.settingsBackdrop}
            activeOpacity={1}
            onPress={() => setIsSettingsVisible(false)}
          />
          <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>Settings</Text>
              <TouchableOpacity
                style={styles.settingsCloseButton}
                onPress={() => setIsSettingsVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
              >
                <Ionicons name="close" size={20} color="#F5F7FF" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Audio feedback</Text>
                <Switch value={audioFeedbackEnabled} onValueChange={setAudioFeedbackEnabled} />
              </View>

              <View style={styles.settingsRow}>
                <View style={styles.settingsLabelGroup}>
                  <Text style={styles.settingsLabel}>MediaPipe shadow</Text>
                  <Text style={styles.settingsHint}>Compare ARKit primary with shadow angles</Text>
                </View>
                <Switch value={shadowModeEnabled} onValueChange={setShadowModeEnabled} />
              </View>

              {Platform.OS === 'ios' && (
                <View style={styles.settingsRow}>
                  <View style={styles.settingsLabelGroup}>
                    <Text style={styles.settingsLabel}>Watch mirroring</Text>
                    <Text style={styles.settingsHint}>
                      {watchReady ? 'Mirror to Apple Watch' : 'Pair watch to enable'}
                    </Text>
                  </View>
                  <Switch
                    value={watchMirrorEnabled}
                    onValueChange={handleWatchMirrorToggle}
                    disabled={!watchReady}
                  />
                </View>
              )}
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Subject lock</Text>
                <Switch value={subjectLockEnabled} onValueChange={setSubjectLockEnabled} />
              </View>
              <TouchableOpacity
                style={[
                  styles.settingsButton,
                  !subjectLockEnabled && styles.settingsButtonDisabled,
                ]}
                onPress={handleReacquireSubject}
                disabled={!subjectLockEnabled}
              >
                <Text style={styles.settingsButtonText}>Reacquire subject</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Gesture recording</Text>
                <Switch value={gestureRecordingEnabled} onValueChange={setGestureRecordingEnabled} />
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Quality</Text>
                <View style={styles.qualityButtons}>
                  {(Object.keys(QUALITY_LABELS) as RecordingQuality[]).map((quality) => {
                    const isActive = recordingQuality === quality;
                    return (
                      <TouchableOpacity
                        key={quality}
                        style={[
                          styles.qualityButton,
                          isActive && styles.qualityButtonActive,
                          (isRecording || isFinalizingRecording) && styles.qualityButtonDisabled,
                        ]}
                        onPress={() => updateRecordingQuality(quality)}
                        disabled={isRecording || isFinalizingRecording}
                      >
                        <Text style={[styles.qualityButtonText, isActive && styles.qualityButtonTextActive]}>
                          {QUALITY_LABELS[quality]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Debug stats</Text>
                <Switch value={showDebugStats} onValueChange={setShowDebugStats} />
              </View>
              {__DEV__ && (
                <TouchableOpacity
                  style={styles.settingsButton}
                  accessibilityRole="button"
                  accessibilityLabel="Exercise replay lab"
                  onPress={() => {
                    setIsSettingsVisible(false);
                    router.push('/exercise-replay');
                  }}
                >
                  <Text style={styles.settingsButtonText}>Exercise replay lab (local only)</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

import React from 'react';
import {
  BackHandler,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useSafeBack } from '@/hooks/use-safe-back';
import {
  useFormTrackingSettings,
  type UseFormTrackingSettingsResult,
} from '@/hooks/use-form-tracking-settings';
import {
  FQI_THRESHOLD_MAX,
  FQI_THRESHOLD_MIN,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  type CueVerbosity,
} from '@/lib/services/form-tracking-settings';

const FQI_STEP = 0.05;
const OPACITY_STEP = 0.05;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

type StepperProps = {
  testID?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter?: (value: number) => string;
  onChange: (next: number) => void;
  disabled?: boolean;
};

const Stepper = ({
  testID,
  label,
  value,
  min,
  max,
  step,
  formatter,
  onChange,
  disabled,
}: StepperProps) => {
  const pct = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 0.0001)));
  const atMin = value <= min + 1e-6;
  const atMax = value >= max - 1e-6;
  const display = formatter ? formatter(value) : value.toFixed(2);

  return (
    <View style={styles.stepperRow} testID={testID}>
      <View style={styles.stepperHeader}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <Text style={styles.stepperValue}>{display}</Text>
      </View>
      <View style={styles.stepperBarTrack}>
        <View style={[styles.stepperBarFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          testID={testID ? `${testID}-dec` : undefined}
          style={[styles.stepperButton, (atMin || disabled) && styles.stepperButtonDisabled]}
          onPress={() => onChange(clamp(value - step, min, max))}
          disabled={atMin || disabled}
          accessibilityLabel={`Decrease ${label}`}
        >
          <Ionicons name="remove" size={22} color={atMin ? '#5E708E' : '#4C8CFF'} />
        </TouchableOpacity>
        <TouchableOpacity
          testID={testID ? `${testID}-inc` : undefined}
          style={[styles.stepperButton, (atMax || disabled) && styles.stepperButtonDisabled]}
          onPress={() => onChange(clamp(value + step, min, max))}
          disabled={atMax || disabled}
          accessibilityLabel={`Increase ${label}`}
        >
          <Ionicons name="add" size={22} color={atMax ? '#5E708E' : '#4C8CFF'} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

type SegmentPickerProps = {
  testID?: string;
  label: string;
  value: CueVerbosity;
  onChange: (next: CueVerbosity) => void;
};

const SegmentPicker = ({ testID, label, value, onChange }: SegmentPickerProps) => {
  const options: CueVerbosity[] = ['minimal', 'standard', 'detailed'];
  return (
    <View style={styles.segmentRow} testID={testID}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.segmentContainer}>
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <TouchableOpacity
              key={opt}
              testID={testID ? `${testID}-${opt}` : undefined}
              style={[styles.segmentButton, selected && styles.segmentButtonSelected]}
              onPress={() => onChange(opt)}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

type ToggleRowProps = {
  testID?: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

const ToggleRow = ({ testID, icon, title, subtitle, value, onChange, disabled }: ToggleRowProps) => (
  <View style={styles.toggleRow} testID={testID}>
    <View style={styles.settingIconContainer}>
      <Ionicons name={icon} size={22} color="#4C8CFF" />
    </View>
    <View style={styles.settingTextContainer}>
      <Text style={styles.settingTitle}>{title}</Text>
      {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    <Switch
      testID={testID ? `${testID}-switch` : undefined}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: '#2A3A54', true: '#4C8CFF' }}
    />
  </View>
);

export default function FormTrackingSettingsModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });
  const {
    settings,
    loading,
    update,
    reset,
  }: UseFormTrackingSettingsResult = useFormTrackingSettings();

  React.useEffect(() => {
    const handler = () => {
      safeBack();
      return true;
    };
    const subscription = BackHandler.addEventListener?.('hardwareBackPress', handler);
    return () => subscription?.remove?.();
  }, [safeBack]);

  const overrideCount = Object.keys(settings.perExerciseOverrides).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={safeBack}
          style={styles.backButton}
          accessibilityLabel="Back"
          testID="ft-settings-back"
        >
          <Ionicons name="arrow-back" size={24} color="#E8EDF5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Form Tracking</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} testID="ft-settings-scroll">
        <Text style={styles.intro}>
          Tune how strict the form-quality gate is and how the coach surfaces feedback.
          Changes apply to your next set.
        </Text>

        <Text style={styles.sectionTitle}>Form quality</Text>
        <View style={styles.card}>
          <Stepper
            testID="ft-settings-fqi"
            label="FQI threshold"
            value={settings.fqiThreshold}
            min={FQI_THRESHOLD_MIN}
            max={FQI_THRESHOLD_MAX}
            step={FQI_STEP}
            onChange={(v) => update({ fqiThreshold: v })}
            disabled={loading}
          />
          <Text style={styles.helperText}>
            Reps below this score are flagged. Lower = more forgiving, higher = stricter.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Feedback</Text>
        <View style={styles.card}>
          <SegmentPicker
            testID="ft-settings-verbosity"
            label="Cue verbosity"
            value={settings.cueVerbosity}
            onChange={(v) => update({ cueVerbosity: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            testID="ft-settings-haptics"
            icon="pulse-outline"
            title="Haptic feedback"
            subtitle="Short vibration per fault"
            value={settings.hapticsEnabled}
            onChange={(v) => update({ hapticsEnabled: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            testID="ft-settings-voice"
            icon="volume-high-outline"
            title="Voice cues"
            subtitle="Speak cues instead of or alongside text"
            value={settings.voiceEnabled}
            onChange={(v) => update({ voiceEnabled: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            testID="ft-settings-count"
            icon="mic-outline"
            title="Rep count audio"
            subtitle="Play a blip on each counted rep"
            value={settings.countAudioEnabled}
            onChange={(v) => update({ countAudioEnabled: v })}
          />
        </View>

        <Text style={styles.sectionTitle}>Display</Text>
        <View style={styles.card}>
          <Stepper
            testID="ft-settings-opacity"
            label="Overlay opacity"
            value={settings.overlayOpacity}
            min={OVERLAY_OPACITY_MIN}
            max={OVERLAY_OPACITY_MAX}
            step={OPACITY_STEP}
            formatter={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update({ overlayOpacity: v })}
            disabled={loading}
          />
        </View>

        <Text style={styles.sectionTitle}>Session</Text>
        <View style={styles.card}>
          <ToggleRow
            testID="ft-settings-autopause"
            icon="pause-circle-outline"
            title="Auto-pause on fault"
            subtitle="Pause recording when a high-severity fault is detected"
            value={settings.autoPauseOnFault}
            onChange={(v) => update({ autoPauseOnFault: v })}
          />
        </View>

        <Text style={styles.sectionTitle}>Per-exercise overrides</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.settingIconContainer}>
              <Ionicons name="barbell-outline" size={22} color="#4C8CFF" />
            </View>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingTitle}>
                {overrideCount === 0
                  ? 'No per-exercise overrides'
                  : `${overrideCount} exercise${overrideCount === 1 ? '' : 's'} customized`}
              </Text>
              <Text style={styles.settingSubtitle}>
                Customize per-exercise from the scan screen long-press menu.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.resetWrap}>
          <TouchableOpacity
            testID="ft-settings-reset"
            style={styles.resetButton}
            onPress={() => reset()}
            accessibilityRole="button"
          >
            <Text style={styles.resetLabel}>Reset to defaults</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050E1F' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#050E1F',
    borderBottomWidth: 1,
    borderBottomColor: '#1B2E4A',
  },
  backButton: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: '#E8EDF5',
    textAlign: 'center',
    marginRight: 40,
  },
  headerSpacer: { width: 32 },
  content: { padding: 16, paddingBottom: 64 },
  intro: { color: '#9AACD1', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9AACD1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  card: {
    backgroundColor: '#0B1A2F',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    overflow: 'hidden',
  },
  stepperRow: { padding: 16 },
  stepperHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepperLabel: { color: '#E8EDF5', fontSize: 15, fontWeight: '500' },
  stepperValue: { color: '#4C8CFF', fontSize: 15, fontWeight: '600' },
  stepperBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1B2E4A',
    overflow: 'hidden',
    marginBottom: 12,
  },
  stepperBarFill: { height: '100%', backgroundColor: '#4C8CFF' },
  stepperControls: { flexDirection: 'row', justifyContent: 'space-between' },
  stepperButton: {
    width: 48,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    backgroundColor: '#050E1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: { opacity: 0.4 },
  helperText: {
    color: '#6781A6',
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
    marginTop: -6,
  },
  segmentRow: { padding: 16 },
  segmentContainer: {
    marginTop: 10,
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    overflow: 'hidden',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#050E1F',
  },
  segmentButtonSelected: { backgroundColor: '#4C8CFF' },
  segmentLabel: { color: '#9AACD1', fontSize: 13, fontWeight: '500' },
  segmentLabelSelected: { color: '#0B1A2F', fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingTextContainer: { flex: 1 },
  settingTitle: { fontSize: 16, fontWeight: '500', color: '#E8EDF5' },
  settingSubtitle: { fontSize: 13, color: '#9AACD1', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#1B2E4A', marginLeft: 64 },
  resetWrap: { marginTop: 24, alignItems: 'center' },
  resetButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.4)',
    backgroundColor: 'rgba(255, 68, 68, 0.08)',
  },
  resetLabel: { color: '#FF6B6B', fontSize: 14, fontWeight: '600' },
});

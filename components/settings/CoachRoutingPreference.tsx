import { StyleSheet, View } from 'react-native';
import { RadioButton, Text } from 'react-native-paper';
import type { CoachRoutingPreference as RoutingPref } from '@/lib/services/coach-dispatch';

export interface CoachRoutingPreferenceProps {
  value: RoutingPref;
  onChange: (next: RoutingPref) => void;
  /** When true, disables the local_only option (e.g. model not ready). */
  localDisabled?: boolean;
}

interface Option {
  key: RoutingPref;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    key: 'cloud_only',
    label: 'Cloud only',
    description: 'Always use the cloud coach. Requires internet.',
  },
  {
    key: 'prefer_local',
    label: 'Prefer on-device (fallback to cloud)',
    description: 'Use on-device model when ready, otherwise fall back to cloud.',
  },
  {
    key: 'local_only',
    label: 'On-device only',
    description: 'Only use the on-device model. No network requests.',
  },
];

export function CoachRoutingPreference(props: CoachRoutingPreferenceProps) {
  const { value, onChange, localDisabled = false } = props;

  return (
    <View
      style={styles.container}
      accessibilityRole="radiogroup"
      accessibilityLabel="Coach routing preference"
      testID="coach-routing-preference"
    >
      <Text variant="titleSmall" style={styles.heading}>
        Coach routing
      </Text>
      <RadioButton.Group
        value={value}
        onValueChange={(next) => {
          if (next === 'cloud_only' || next === 'prefer_local' || next === 'local_only') {
            onChange(next);
          }
        }}
      >
        {OPTIONS.map((opt) => {
          const disabled = localDisabled && opt.key === 'local_only';
          const testId = `coach-routing-preference-${opt.key}`;
          return (
            <View
              key={opt.key}
              style={styles.row}
              testID={testId}
              accessibilityLabel={opt.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === opt.key, disabled }}
            >
              <RadioButton
                value={opt.key}
                disabled={disabled}
              />
              <View style={styles.labelWrap}>
                <Text variant="bodyMedium" style={disabled ? styles.labelDisabled : undefined}>
                  {opt.label}
                </Text>
                <Text variant="bodySmall" style={disabled ? styles.descDisabled : styles.desc}>
                  {opt.description}
                </Text>
              </View>
            </View>
          );
        })}
      </RadioButton.Group>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  heading: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  labelWrap: {
    flex: 1,
    paddingLeft: 4,
  },
  desc: {
    opacity: 0.7,
  },
  descDisabled: {
    opacity: 0.4,
  },
  labelDisabled: {
    opacity: 0.5,
  },
});

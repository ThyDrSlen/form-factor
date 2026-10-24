import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { RadioButton, Text } from 'react-native-paper';
import type { CoachModelTier } from '@/lib/services/coach-model-tier-preference';

export interface CoachModelTierCardProps {
  value: CoachModelTier;
  onChange: (next: CoachModelTier) => void;
}

interface Option {
  key: CoachModelTier;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    key: 'fast',
    label: 'Fast',
    description: 'Prioritize snappy replies (lighter model).',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    description: 'Let the coach auto-pick based on the task (default).',
  },
  {
    key: 'smart',
    label: 'Smart',
    description: 'Prefer higher-quality answers — may take longer.',
  },
];

/**
 * Radio card for the user's preferred speed/quality tier. The dispatcher
 * consumes this as a hint; the card itself only persists the selection.
 */
export function CoachModelTierCard(props: CoachModelTierCardProps) {
  const { value, onChange } = props;

  return (
    <View
      style={styles.container}
      accessibilityRole="radiogroup"
      accessibilityLabel="Coach model tier"
      testID="coach-model-tier-card"
    >
      <Text variant="titleSmall" style={styles.heading}>
        Speed vs quality
      </Text>
      <RadioButton.Group
        value={value}
        onValueChange={(next) => {
          if (next === 'fast' || next === 'balanced' || next === 'smart') {
            onChange(next);
          }
        }}
      >
        {OPTIONS.map((opt) => {
          const testId = `coach-model-tier-card-${opt.key}`;
          return (
            <TouchableOpacity
              key={opt.key}
              style={styles.row}
              testID={testId}
              accessibilityLabel={opt.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === opt.key }}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.7}
            >
              <RadioButton value={opt.key} />
              <View style={styles.labelWrap}>
                <Text variant="bodyMedium">{opt.label}</Text>
                <Text variant="bodySmall" style={styles.desc}>
                  {opt.description}
                </Text>
              </View>
            </TouchableOpacity>
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
});

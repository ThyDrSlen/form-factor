import { StyleSheet, View } from 'react-native';

interface OnboardingProgressProps {
  current: number;
  total: number;
}

export function OnboardingProgress({ current, total }: OnboardingProgressProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i + 1 === current && styles.dotActive,
            i + 1 < current && styles.dotCompleted,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1B2E4A',
  },
  dotActive: {
    width: 24,
    borderRadius: 4,
    backgroundColor: '#4C8CFF',
  },
  dotCompleted: {
    backgroundColor: '#4C8CFF',
    opacity: 0.5,
  },
});

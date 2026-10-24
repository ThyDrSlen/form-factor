import { theme } from '@/styles/theme';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFirstSessionCheck } from '@/features/form-tracking/hooks/use-first-session-check';

export interface StartSessionCtaProps {
  /** Optional override — used mostly for tests. Defaults to the setup-aware form flow. */
  onPress?: () => void;
}

export function StartSessionCta({ onPress }: StartSessionCtaProps) {
  const router = useRouter();
  const { hasSeenSetup } = useFirstSessionCheck();
  const isSetupStatusLoading = !onPress && hasSeenSetup === null;
  const handlePress = () => {
    if (isSetupStatusLoading) {
      return;
    }
    if (onPress) {
      onPress();
      return;
    }
    router.push(hasSeenSetup ? '/(tabs)/scan-arkit' : '/(modals)/form-tracking-setup');
  };
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Analyze form"
      accessibilityHint="Opens the camera, with setup guidance on your first use"
      accessibilityState={{ busy: isSetupStatusLoading, disabled: isSetupStatusLoading }}
      onPress={handlePress}
      disabled={isSetupStatusLoading}
      style={[styles.button, isSetupStatusLoading && styles.buttonDisabled]}
      activeOpacity={0.85}
      testID="start-session-cta"
    >
      <View style={styles.iconBubble}>
        <Ionicons name="scan-outline" size={20} color="#0B0F1C" />
      </View>
      <View style={styles.copyWrap}>
        <Text style={styles.label}>Analyze form</Text>
        <Text style={styles.helper}>
          {isSetupStatusLoading
            ? 'Checking setup status...'
            : 'Use your camera for live form feedback'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#0B0F1C" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#4C8CFF',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 247, 255, 0.22)',
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9, 20, 38, 0.10)',
  },
  copyWrap: {
    flex: 1,
  },
  label: {
    color: '#0B0F1C',
    fontSize: 16,
    fontFamily: theme.font.bold,
  },
  helper: {
    color: 'rgba(11, 15, 28, 0.76)',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
    fontWeight: '600',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { useUnits } from '@/contexts/UnitsContext';
import { useToast } from '@/contexts/ToastContext';
import { isIOS } from '@/lib/platform-utils';

type GoalProfile = 'strength' | 'hypertrophy' | 'endurance' | 'general';

const goalOptions: { value: GoalProfile; label: string; icon: string; description: string }[] = [
  { value: 'strength', label: 'Strength', icon: 'barbell-outline', description: 'Focus on heavy lifts and PRs' },
  { value: 'hypertrophy', label: 'Hypertrophy', icon: 'body-outline', description: 'Build muscle size and volume' },
  { value: 'endurance', label: 'Endurance', icon: 'heart-outline', description: 'Improve stamina and conditioning' },
  { value: 'general', label: 'General Fitness', icon: 'fitness-outline', description: 'Balanced overall fitness' },
];

export default function ProfileSetupScreen() {
  const { user, updateProfile } = useAuth();
  const { weightUnit, toggleWeightUnit } = useUnits();
  const { show: showToast } = useToast();
  const router = useRouter();
  const isiOS = isIOS();

  const [displayName, setDisplayName] = useState(user?.user_metadata?.full_name || '');
  const [fitnessGoal, setFitnessGoal] = useState<GoalProfile>('general');
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    setSaving(true);
    try {
      if (displayName.trim()) {
        const { error } = await updateProfile({ fullName: displayName.trim() });
        if (error) {
          Alert.alert('Error', 'Failed to save profile. Please try again.');
          setSaving(false);
          return;
        }
      }
      await AsyncStorage.setItem('@fitness_goal', fitnessGoal);
      showToast('Profile set up!', { type: 'success' });
      router.replace('/(onboarding)/nutrition-goals');
    } catch {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    router.replace('/(onboarding)/nutrition-goals');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={isiOS ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.backPlaceholder} />
          <Text style={styles.headerTitle}>Set Up Your Profile</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Ionicons name="person-outline" size={48} color="#4C8CFF" />
          </View>

          <Text style={styles.welcomeTitle}>Tell us about yourself</Text>
          <Text style={styles.descriptionText}>
            Customize your experience. You can always change these later.
          </Text>

          {/* Display Name */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Display Name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="What should we call you?"
              placeholderTextColor="#8CA5C6"
              autoCapitalize="words"
              editable={!saving}
            />
          </View>

          {/* Fitness Goal */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Fitness Goal</Text>
            <View style={styles.goalGrid}>
              {goalOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.goalCard,
                    fitnessGoal === option.value && styles.goalCardSelected,
                  ]}
                  onPress={() => setFitnessGoal(option.value)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={option.icon as any}
                    size={24}
                    color={fitnessGoal === option.value ? '#4C8CFF' : '#6781A6'}
                  />
                  <Text style={[styles.goalLabel, fitnessGoal === option.value && styles.goalLabelSelected]}>
                    {option.label}
                  </Text>
                  <Text style={styles.goalDescription}>{option.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Units Preference */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Weight Units</Text>
            <View style={styles.unitToggle}>
              <TouchableOpacity
                style={[styles.unitOption, weightUnit === 'lbs' && styles.unitOptionActive]}
                onPress={() => { if (weightUnit !== 'lbs') toggleWeightUnit(); }}
              >
                <Text style={[styles.unitText, weightUnit === 'lbs' && styles.unitTextActive]}>lbs</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitOption, weightUnit === 'kg' && styles.unitOptionActive]}
                onPress={() => { if (weightUnit !== 'kg') toggleWeightUnit(); }}
              >
                <Text style={[styles.unitText, weightUnit === 'kg' && styles.unitTextActive]}>kg</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.continueButton, saving && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={saving}
          >
            <Text style={styles.continueButtonText}>
              {saving ? 'Saving...' : 'Continue'}
            </Text>
            {!saving && <Ionicons name="arrow-forward" size={20} color="#fff" />}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton} disabled={saving}>
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  content: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backPlaceholder: {
    width: 40,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5F7FF',
    textAlign: 'center',
    marginBottom: 12,
  },
  descriptionText: {
    color: '#9AACD1',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#13263C',
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#F5F7FF',
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  goalCard: {
    flexBasis: '48%',
    backgroundColor: '#13263C',
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  goalCardSelected: {
    borderColor: '#4C8CFF',
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
  },
  goalLabel: {
    color: '#9AACD1',
    fontSize: 14,
    fontWeight: '600',
  },
  goalLabelSelected: {
    color: '#F5F7FF',
  },
  goalDescription: {
    color: '#6781A6',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 14,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: '#13263C',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    overflow: 'hidden',
  },
  unitOption: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  unitOptionActive: {
    backgroundColor: '#4C8CFF',
  },
  unitText: {
    color: '#9AACD1',
    fontSize: 16,
    fontWeight: '700',
  },
  unitTextActive: {
    color: '#fff',
  },
  continueButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#2F4B66',
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  skipButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  skipButtonText: {
    color: '#9AACD1',
    fontSize: 14,
    fontWeight: '600',
  },
});

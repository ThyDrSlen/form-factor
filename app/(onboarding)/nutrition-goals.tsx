import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
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
import { useSafeBack } from '@/hooks/use-safe-back';
import { useNutritionGoals } from '@/contexts/NutritionGoalsContext';
import { useToast } from '@/contexts/ToastContext';
import { isIOS } from '@/lib/platform-utils';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { markOnboardingCompleted } from '@/lib/services/onboarding';
import { trackOnboardingEvent } from '@/lib/services/onboarding-analytics';

export default function NutritionGoalsScreen() {
  const { goals, saveGoals, isSyncing, loading } = useNutritionGoals();
  const { show: showToast } = useToast();
  const isiOS = isIOS();
  const safeBack = useSafeBack('/(tabs)');

  useEffect(() => {
    trackOnboardingEvent('step_view', 'nutrition-goals');
  }, []);

  const [calories, setCalories] = useState(goals?.calories?.toString() || '');
  const [protein, setProtein] = useState(goals?.protein?.toString() || '');
  const [carbs, setCarbs] = useState(goals?.carbs?.toString() || '');
  const [fat, setFat] = useState(goals?.fat?.toString() || '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const proteinRef = useRef<TextInput>(null);
  const carbsRef = useRef<TextInput>(null);
  const fatRef = useRef<TextInput>(null);

  function normalizeDecimal(value: string): string {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }

  function setFieldError(field: string, message?: string) {
    setErrors((prev: Record<string, string>) => {
      if (!message) {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }

      if (prev[field] === message) return prev;
      return { ...prev, [field]: message };
    });
  }

  function getFieldError(field: 'calories' | 'protein' | 'carbs' | 'fat', value: string): string | undefined {
    const trimmed = value.trim();

    if (!trimmed) {
      return field === 'calories' ? 'Enter a calorie goal between 500 and 10,000' : undefined;
    }

    const parsed = parseFloat(trimmed);
    if (isNaN(parsed)) {
      return field === 'calories'
        ? 'Enter a calorie goal between 500 and 10,000'
        : `Enter ${field} between 0 and 1,000 g`;
    }

    if (field === 'calories') {
      return parsed < 500 || parsed > 10000 ? 'Enter a calorie goal between 500 and 10,000' : undefined;
    }

    return parsed < 0 || parsed > 1000 ? `Enter ${field} between 0 and 1,000 g` : undefined;
  }

  function validateField(field: 'calories' | 'protein' | 'carbs' | 'fat', value: string): boolean {
    const message = getFieldError(field, value);
    setFieldError(field, message);
    return !message;
  }

  function validateForm(): boolean {
    const validations = [
      validateField('calories', calories),
      validateField('protein', protein),
      validateField('carbs', carbs),
      validateField('fat', fat),
    ];

    return validations.every(Boolean);
  }

  function handleFieldChange(field: 'calories' | 'protein' | 'carbs' | 'fat', value: string) {
    const normalized = normalizeDecimal(value);

    if (field === 'calories') setCalories(normalized);
    if (field === 'protein') setProtein(normalized);
    if (field === 'carbs') setCarbs(normalized);
    if (field === 'fat') setFat(normalized);

    if (errors[field]) {
      validateField(field, normalized);
    }
  }

  const handleSave = async () => {
    if (!validateForm()) {
      const firstError =
        getFieldError('calories', calories)
        ?? getFieldError('protein', protein)
        ?? getFieldError('carbs', carbs)
        ?? getFieldError('fat', fat)
        ?? 'Please enter valid nutrition goals';
      Alert.alert('Error', firstError);
      return;
    }

    try {
      const { error } = await saveGoals({
        calories: parseFloat(calories),
        protein: protein.trim() ? parseFloat(protein) : undefined,
        carbs: carbs.trim() ? parseFloat(carbs) : undefined,
        fat: fat.trim() ? parseFloat(fat) : undefined,
      });

      if (error) {
        Alert.alert('Error', error.message || 'Failed to save goals. Please try again.');
        return;
      }

      await markOnboardingCompleted();
      trackOnboardingEvent('step_complete', 'nutrition-goals');
      showToast('Nutrition goals saved successfully! 🎯', { type: 'success' });
      safeBack();
    } catch {
      Alert.alert('Error', 'Failed to save goals. Please try again.');
    }
  };

  const handleSkip = async () => {
    trackOnboardingEvent('step_skip', 'nutrition-goals');
    if (goals) {
      await markOnboardingCompleted();
      safeBack();
      return;
    }

    try {
      const { error } = await saveGoals({
        calories: 2000,
        protein: undefined,
        carbs: undefined,
        fat: undefined,
      });

      if (error) {
        Alert.alert('Error', error.message || 'Failed to save goals. Please try again.');
        return;
      }

      await markOnboardingCompleted();
      safeBack();
    } catch {
      Alert.alert('Error', 'Failed to save goals. Please try again.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

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
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Set Nutrition Goals</Text>
          <View style={styles.headerSpacer} />
        </View>

        <OnboardingProgress current={2} total={2} />

        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Ionicons name="nutrition-outline" size={48} color="#4C8CFF" />
          </View>

          <Text style={styles.welcomeTitle}>
            Let&apos;s set your nutrition goals
          </Text>

          <Text style={styles.descriptionText}>
            Set your daily targets to track your progress. You can always update these later in your profile settings.
          </Text>

          <Text style={styles.contextText}>
            Nutrition goals help you compare what you eat against a daily target. Most people land around
            1,500–3,000 calories, while macros often stay between 50–250g depending on goals.
          </Text>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Daily Calories *</Text>
            <TextInput
              style={[styles.input, errors.calories && styles.inputError]}
              value={calories}
              onChangeText={(t: string) => handleFieldChange('calories', t)}
              onBlur={() => validateField('calories', calories)}
              inputMode="decimal"
              keyboardType="decimal-pad"
              placeholder="e.g., 2000"
              placeholderTextColor="#8CA5C6"
              editable={!isSyncing}
              accessibilityLabel="Daily calorie target in kilocalories"
              returnKeyType="next"
              onSubmitEditing={() => proteinRef.current?.focus()}
            />
            {errors.calories ? <Text style={styles.errorText}>{errors.calories}</Text> : null}
          </View>

          <View style={styles.row}>
            <View style={[styles.inputContainer, styles.thirdWidth]}>
              <Text style={styles.label}>Protein (g)</Text>
              <TextInput
                ref={proteinRef}
                style={[styles.input, errors.protein && styles.inputError]}
                value={protein}
                onChangeText={(t: string) => handleFieldChange('protein', t)}
                onBlur={() => validateField('protein', protein)}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="Optional"
                placeholderTextColor="#8CA5C6"
                editable={!isSyncing}
                accessibilityLabel="Daily protein target in grams"
                returnKeyType="next"
                onSubmitEditing={() => carbsRef.current?.focus()}
              />
              {errors.protein ? <Text style={styles.errorText}>{errors.protein}</Text> : null}
            </View>

            <View style={[styles.inputContainer, styles.thirdWidth]}>
              <Text style={styles.label}>Carbs (g)</Text>
              <TextInput
                ref={carbsRef}
                style={[styles.input, errors.carbs && styles.inputError]}
                value={carbs}
                onChangeText={(t: string) => handleFieldChange('carbs', t)}
                onBlur={() => validateField('carbs', carbs)}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="Optional"
                placeholderTextColor="#8CA5C6"
                editable={!isSyncing}
                accessibilityLabel="Daily carbohydrate target in grams"
                returnKeyType="next"
                onSubmitEditing={() => fatRef.current?.focus()}
              />
              {errors.carbs ? <Text style={styles.errorText}>{errors.carbs}</Text> : null}
            </View>

            <View style={[styles.inputContainer, styles.thirdWidth]}>
              <Text style={styles.label}>Fat (g)</Text>
              <TextInput
                ref={fatRef}
                style={[styles.input, errors.fat && styles.inputError]}
                value={fat}
                onChangeText={(t: string) => handleFieldChange('fat', t)}
                onBlur={() => validateField('fat', fat)}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="Optional"
                placeholderTextColor="#8CA5C6"
                editable={!isSyncing}
                accessibilityLabel="Daily fat target in grams"
                returnKeyType="done"
              />
              {errors.fat ? <Text style={styles.errorText}>{errors.fat}</Text> : null}
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.saveButton,
              (!calories.trim() || isSyncing) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!calories.trim() || isSyncing}
          >
            {isSyncing ? (
              <Ionicons name="hourglass" size={20} color="#fff" />
            ) : (
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
            )}
            <Text style={styles.saveButtonText}>
              {isSyncing ? 'Saving...' : 'Save Goals'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton} disabled={isSyncing}>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050E1F',
  },
  loadingText: {
    fontSize: 18,
    color: '#F5F7FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#050E1F',
  },
  backButton: {
    padding: 8,
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
  content: {
    padding: 20,
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
    marginBottom: 12,
    lineHeight: 20,
  },
  contextText: {
    color: '#C6D4EE',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
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
  inputError: {
    borderColor: '#FF6B6B',
  },
  errorText: {
    color: '#FF8A8A',
    fontSize: 12,
    marginTop: 6,
    marginLeft: 2,
    lineHeight: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  thirdWidth: {
    flex: 1,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#2F4B66',
  },
  saveButtonText: {
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

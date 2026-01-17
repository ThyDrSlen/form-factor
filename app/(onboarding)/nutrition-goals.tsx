import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
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

export default function NutritionGoalsScreen() {
  const { goals, saveGoals, isSyncing, loading } = useNutritionGoals();
  const { show: showToast } = useToast();
  const isiOS = isIOS();
  const safeBack = useSafeBack('/(tabs)');

  const [calories, setCalories] = useState(goals?.calories?.toString() || '');
  const [protein, setProtein] = useState(goals?.protein?.toString() || '');
  const [carbs, setCarbs] = useState(goals?.carbs?.toString() || '');
  const [fat, setFat] = useState(goals?.fat?.toString() || '');

  function normalizeDecimal(value: string): string {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }

  const handleSave = async () => {
    if (!calories.trim() || parseFloat(calories) <= 0) {
      Alert.alert('Error', 'Please enter valid calorie goal');
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

      showToast('Nutrition goals saved successfully! 🎯', { type: 'success' });
      safeBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to save goals. Please try again.');
    }
  };

  const handleSkip = async () => {
    if (goals) {
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

      safeBack();
    } catch (error) {
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

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Daily Calories *</Text>
            <TextInput
              style={styles.input}
              value={calories}
              onChangeText={(t) => setCalories(normalizeDecimal(t))}
              inputMode="decimal"
              keyboardType="decimal-pad"
              placeholder="e.g., 2000"
              placeholderTextColor="#8CA5C6"
              editable={!isSyncing}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputContainer, styles.thirdWidth]}>
              <Text style={styles.label}>Protein (g)</Text>
              <TextInput
                style={styles.input}
                value={protein}
                onChangeText={(t) => setProtein(normalizeDecimal(t))}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="Optional"
                placeholderTextColor="#8CA5C6"
                editable={!isSyncing}
              />
            </View>

            <View style={[styles.inputContainer, styles.thirdWidth]}>
              <Text style={styles.label}>Carbs (g)</Text>
              <TextInput
                style={styles.input}
                value={carbs}
                onChangeText={(t) => setCarbs(normalizeDecimal(t))}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="Optional"
                placeholderTextColor="#8CA5C6"
                editable={!isSyncing}
              />
            </View>

            <View style={[styles.inputContainer, styles.thirdWidth]}>
              <Text style={styles.label}>Fat (g)</Text>
              <TextInput
                style={styles.input}
                value={fat}
                onChangeText={(t) => setFat(normalizeDecimal(t))}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="Optional"
                placeholderTextColor="#8CA5C6"
                editable={!isSyncing}
              />
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
    marginBottom: 24,
    lineHeight: 20,
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

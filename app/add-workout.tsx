import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform, Keyboard, InputAccessoryView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkouts } from '../contexts/WorkoutsContext';
import { useSafeBack } from '../hooks/use-safe-back';

export default function AddWorkoutScreen() {
  const router = useRouter();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { addWorkout } = useWorkouts();

  const [exercise, setExercise] = useState('');
  const [sets, setSets] = useState('1');
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const setsRef = React.useRef<TextInput>(null);
  const repsRef = React.useRef<TextInput>(null);
  const weightRef = React.useRef<TextInput>(null);
  const accessoryID = 'numericAccessory';

  function onlyDigits(value: string): string {
    return value.replace(/[^0-9]/g, '');
  }

  // Prefer a safe back action: if there's no history, go directly to the Workouts tab inside tabs group
  const safeBack = useSafeBack('/(tabs)/workouts');

  const onSave = async () => {
    if (!exercise.trim()) {
      Alert.alert('Error', 'Please enter an exercise name');
      return;
    }
    
    setSaving(true);
    try {
      const id = Date.now().toString();
      const workout = { 
        id, 
        exercise: exercise.trim(), 
        sets: parseInt(sets, 10) || 1, 
        reps: reps ? parseInt(reps, 10) : undefined, 
        weight: weight ? parseInt(weight, 10) : undefined, 
        date: new Date().toISOString() 
      };
      
      console.log('Saving workout:', workout);
      await addWorkout(workout);
      
      Alert.alert('Success', 'Workout saved successfully!', [
        { text: 'OK', onPress: () => safeBack() }
      ]);
    } catch (error) {
      console.error('Error saving workout:', error);
      Alert.alert('Error', 'Failed to save workout. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log Workout</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Exercise *</Text>
          <TextInput 
            style={styles.input} 
            value={exercise} 
            onChangeText={setExercise} 
            placeholder="e.g., Push-ups, Squats, Bench Press" 
            editable={!saving}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputContainer, styles.halfWidth]}>
            <Text style={styles.label}>Sets</Text>
            <TextInput 
              ref={setsRef}
              style={styles.input} 
              value={sets} 
              onChangeText={(t) => setSets(onlyDigits(t))} 
              inputMode="numeric"
              keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'} 
              placeholder="1"
              editable={!saving}
              returnKeyType="next"
              onSubmitEditing={() => repsRef.current?.focus()}
              blurOnSubmit={false}
              inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
            />
          </View>

          <View style={[styles.inputContainer, styles.halfWidth]}>
            <Text style={styles.label}>Reps</Text>
            <TextInput 
              ref={repsRef}
              style={styles.input} 
              value={reps} 
              onChangeText={(t) => setReps(onlyDigits(t))} 
              inputMode="numeric"
              keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'} 
              placeholder="Optional"
              editable={!saving}
              returnKeyType="next"
              onSubmitEditing={() => weightRef.current?.focus()}
              blurOnSubmit={false}
              inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
            />
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Weight (lbs)</Text>
          <TextInput 
            ref={weightRef}
            style={styles.input} 
            value={weight} 
            onChangeText={(t) => setWeight(onlyDigits(t))} 
            inputMode="numeric"
            keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'} 
            placeholder="Optional"
            editable={!saving}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
          />
        </View>

        <TouchableOpacity 
          style={[styles.saveButton, (!exercise.trim() || saving) && styles.saveButtonDisabled]} 
          onPress={onSave} 
          disabled={!exercise.trim() || saving}
        >
          {saving ? (
            <Ionicons name="hourglass" size={20} color="#fff" />
          ) : (
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
          )}
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving...' : 'Save Workout'}
          </Text>
        </TouchableOpacity>
      </View>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={accessoryID}>
          <View style={styles.accessoryContainer}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.accessoryButton}>
              <Text style={styles.accessoryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F9FF' 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  inputContainer: {
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  halfWidth: {
    flex: 1,
  },
  label: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#1C1C1E',
    marginBottom: 8,
  },
  input: { 
    backgroundColor: '#FFFFFF',
    borderWidth: 1, 
    borderColor: '#E5E5EA', 
    borderRadius: 12, 
    padding: 16, 
    fontSize: 16,
    color: '#1C1C1E',
  },
  accessoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F2F2F7',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D1D1D6',
  },
  accessoryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  accessoryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: { 
    flexDirection: 'row', 
    backgroundColor: '#007AFF', 
    padding: 16, 
    borderRadius: 12, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginTop: 32,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    backgroundColor: '#8E8E93',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: '600', 
    marginLeft: 8,
  },
});

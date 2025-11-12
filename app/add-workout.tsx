import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useWorkouts } from '../contexts/WorkoutsContext';
import { useToast } from '../contexts/ToastContext';
import { useSafeBack } from '../hooks/use-safe-back';

const COMMON_WORKOUTS = [
  'Bench Press',
  'Back Squat',
  'Deadlift',
  'Overhead Press',
  'Lat Pulldown',
  'Pull-Up',
  'Push-Up',
  'Dumbbell Row',
  'Incline Bench',
  'Leg Press',
  'Leg Curl',
  'Leg Extension',
  'Bicep Curl',
  'Tricep Dip',
  'Plank',
  'Russian Twist',
  'Mountain Climbers',
  'Burpees',
  'Jump Rope',
  'HIIT Circuit',
];

const SET_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);
const REP_OPTIONS = Array.from({ length: 41 }, (_, i) => i);
const WEIGHT_OPTIONS = Array.from({ length: 101 }, (_, i) => i * 5);
const WHEEL_ITEM_HEIGHT = 44;
const LOOP_MULTIPLIER = 5;

interface WheelPickerProps {
  label: string;
  values: number[];
  selectedValue: number;
  onChange: (value: number) => void;
  accessibilityLabel?: string;
  formatValue?: (value: number) => string;
}

function WheelPicker({ label, values, selectedValue, onChange, accessibilityLabel, formatValue }: WheelPickerProps) {
  const listRef = useRef<FlatList<number>>(null);
  const loopData = useMemo(() => {
    const repeated = [] as number[];
    for (let i = 0; i < LOOP_MULTIPLIER; i += 1) {
      repeated.push(...values);
    }
    return repeated;
  }, [values]);

  const middleSegmentStart = values.length * Math.floor(LOOP_MULTIPLIER / 2);

  useEffect(() => {
    const targetIndex = loopData.findIndex((value, index) => index >= middleSegmentStart && value === selectedValue);
    const fallbackIndex = targetIndex >= 0 ? targetIndex : middleSegmentStart;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: fallbackIndex * WHEEL_ITEM_HEIGHT, animated: false });
    });
  }, [loopData, middleSegmentStart, selectedValue]);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const rawIndex = Math.round(offset / WHEEL_ITEM_HEIGHT);
    const safeIndex = ((rawIndex % values.length) + values.length) % values.length;
    const centeredIndex = safeIndex + middleSegmentStart;
    const value = loopData[centeredIndex];
    if (centeredIndex !== rawIndex) {
      listRef.current?.scrollToOffset({ offset: centeredIndex * WHEEL_ITEM_HEIGHT, animated: false });
    }
    
    // Add haptic feedback when value changes
    Haptics.selectionAsync();
    onChange(value);
  };

  return (
    <View style={styles.wheelContainer} accessibilityLabel={accessibilityLabel} accessible>
      <Text style={styles.wheelLabel}>{label}</Text>
      <View style={styles.wheelWindow}>
        <FlatList
          ref={listRef}
          data={loopData}
          keyExtractor={(item, index) => `${item}-${index}`}
          showsVerticalScrollIndicator={false}
          snapToInterval={WHEEL_ITEM_HEIGHT}
          getItemLayout={(_, index) => ({ length: WHEEL_ITEM_HEIGHT, offset: WHEEL_ITEM_HEIGHT * index, index })}
          contentContainerStyle={styles.wheelContent}
          onMomentumScrollEnd={handleMomentumEnd}
          decelerationRate="fast"
          renderItem={({ item }) => {
            const isSelected = item === selectedValue;
            const display = formatValue ? formatValue(item) : `${item}`;
            return (
              <View style={[styles.wheelItem, { height: WHEEL_ITEM_HEIGHT }]}> 
                <Text style={[styles.wheelItemText, isSelected && styles.wheelItemTextSelected]}>{display}</Text>
              </View>
            );
          }}
        />
        <View pointerEvents="none" style={styles.wheelSelectionOverlay} />
      </View>
    </View>
  );
}

export default function AddWorkoutScreen() {
  const { addWorkout } = useWorkouts();
  const { show: showToast } = useToast();

  const [exercise, setExercise] = useState<string>(COMMON_WORKOUTS[0]);
  const [exerciseModalVisible, setExerciseModalVisible] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [sets, setSets] = useState<number>(SET_OPTIONS[2]);
  const [reps, setReps] = useState<number>(10);
  const [weight, setWeight] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const filteredExercises = useMemo(() => {
    const trimmed = exerciseSearch.trim().toLowerCase();
    if (!trimmed) {
      return COMMON_WORKOUTS;
    }
    return COMMON_WORKOUTS.filter((name) => name.toLowerCase().includes(trimmed));
  }, [exerciseSearch]);

  const showExerciseActionSheet = () => {
    const options = [...COMMON_WORKOUTS, 'Add Custom…', 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const customIndex = options.length - 2;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Select Exercise',
        options,
        cancelButtonIndex,
        userInterfaceStyle: 'light',
      },
      (selectedIndex) => {
        if (selectedIndex === cancelButtonIndex || selectedIndex == null) {
          return;
        }

        if (selectedIndex === customIndex) {
          Alert.prompt('Add Custom Exercise', 'Enter the exercise name', (text) => {
            const custom = text?.trim();
            if (custom) {
              setExercise(custom);
            }
          }, 'plain-text');
          return;
        }

        const name = options[selectedIndex];
        if (name) {
          setExercise(name);
        }
      }
    );
  };

  const handleExercisePress = () => {
    Haptics.selectionAsync();
    if (Platform.OS === 'ios') {
      showExerciseActionSheet();
    } else {
      setExerciseModalVisible(true);
    }
  };

  // Prefer a safe back action: if there's no history, go directly to the Workouts tab inside tabs group
  const safeBack = useSafeBack(['/workouts', '/(tabs)/workouts'], { alwaysReplace: true });

 const onSave = async () => {
    if (!exercise.trim()) {
      Alert.alert('Error', 'Please enter an exercise name');
      return;
    }
    
    setSaving(true);
    try {
      const id = Crypto.randomUUID();
      const workout = { 
        id, 
        exercise: exercise.trim(), 
        sets,
        reps: reps > 0 ? reps : undefined,
        weight: weight > 0 ? weight : undefined,
        date: new Date().toISOString() 
      };
      
      console.log('Saving workout:', workout);
      await addWorkout(workout);
      
      showToast('Workout saved!', { type: 'success' });
      Alert.alert('Success', 'Workout saved successfully!', [
        {
          text: 'OK',
          onPress: () => {
            console.log('[AddWorkout] success -> safeBack');
            safeBack();
          },
        },
      ]);
    } catch (error) {
      console.error('Error saving workout:', error);
      showToast('Failed to save workout. Please try again.', { type: 'error' });
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
          <Ionicons name="arrow-back" size={24} color="#9AACD1" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log Workout</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <LinearGradient
          colors={['#0F2339', '#081526']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientCard}
        >
          <View style={styles.selectorContainer}>
            <Text style={styles.label}>Exercise *</Text>
            <TouchableOpacity
              style={styles.selector}
              onPress={handleExercisePress}
              disabled={saving}
              accessibilityRole="button"
              accessibilityHint="Choose from common workouts or search to add your own"
            >
              <Text style={[styles.selectorValue, !exercise && styles.selectorPlaceholder]}>
                {exercise || 'Select an exercise'}
              </Text>
              <Ionicons name="chevron-down" size={20} color="#9AACD1" />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <LinearGradient
          colors={['#0F2339', '#081526']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientCard}
        >
          <View style={styles.wheelsRow}>
            <WheelPicker label="Sets" values={SET_OPTIONS} selectedValue={sets} onChange={setSets} />
            <WheelPicker
              label="Reps"
              values={REP_OPTIONS}
              selectedValue={reps}
              onChange={setReps}
              formatValue={(value) => (value === 0 ? '—' : `${value}`)}
            />
            <WheelPicker
              label="Weight"
              values={WEIGHT_OPTIONS}
              selectedValue={weight}
              onChange={setWeight}
              formatValue={(value) => (value === 0 ? '—' : `${value} lb`)}
            />
          </View>
        </LinearGradient>

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
      {Platform.OS !== 'ios' && exerciseModalVisible ? (
        <View style={styles.overlay}>
          <Pressable style={styles.overlayBackdrop} onPress={() => setExerciseModalVisible(false)} />
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setExerciseModalVisible(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={24} color="#007AFF" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Choose Exercise</Text>
              <View style={styles.modalCloseButton} />
            </View>
            <View style={styles.modalSearchContainer}>
              <Ionicons name="search" size={18} color="#636366" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search or type custom"
                value={exerciseSearch}
                onChangeText={setExerciseSearch}
                returnKeyType="search"
              />
              {exerciseSearch.length > 0 ? (
                <TouchableOpacity onPress={() => setExerciseSearch('')} accessibilityRole="button">
                  <Ionicons name="close-circle" size={18} color="#C7C7CC" />
                </TouchableOpacity>
              ) : null}
            </View>
            <FlatList
              data={filteredExercises}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setExercise(item);
                    setExerciseSearch('');
                    setExerciseModalVisible(false);
                  }}
                >
                  <Text style={styles.modalRowText}>{item}</Text>
                  {exercise === item ? <Ionicons name="checkmark" size={18} color="#007AFF" /> : null}
                </Pressable>
              )}
              ItemSeparatorComponent={() => <View style={styles.modalSeparator} />}
              ListEmptyComponent={() => (
                <View style={styles.modalEmptyState}>
                  <Text style={styles.modalEmptyStateText}>No matches found</Text>
                </View>
              )}
              contentContainerStyle={styles.modalListContent}
            />
            <TouchableOpacity
              style={[styles.modalCustomButton, exerciseSearch.trim().length === 0 && styles.modalCustomButtonDisabled]}
              onPress={() => {
                const custom = exerciseSearch.trim();
                if (!custom) return;
                Haptics.selectionAsync();
                setExercise(custom);
                setExerciseSearch('');
                setExerciseModalVisible(false);
              }}
              disabled={exerciseSearch.trim().length === 0}
            >
              <Text style={styles.modalCustomButtonText}>
                {exerciseSearch.trim().length ? `Use "${exerciseSearch.trim()}"` : 'Type a name to add custom exercise'}
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#050E1F' 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
    gap: 24,
  },
  gradientCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  selectorContainer: {
    gap: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9AACD1',
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F2339',
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectorValue: {
    fontSize: 16,
    color: '#F5F7FF',
    flex: 1,
    marginRight: 12,
  },
  selectorPlaceholder: {
    color: '#6781A6',
  },
  wheelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  wheelContainer: {
    flex: 1,
    alignItems: 'center',
  },
  wheelLabel: {
    fontSize: 14,
    color: '#9AACD1',
    marginBottom: 8,
    fontWeight: '600',
  },
  wheelWindow: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    backgroundColor: '#0F2339',
    overflow: 'hidden',
    height: WHEEL_ITEM_HEIGHT * 5,
  },
  wheelContent: {
    paddingVertical: WHEEL_ITEM_HEIGHT * 2,
  },
  wheelItem: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelItemText: {
    fontSize: 18,
    color: '#9AACD1',
    fontWeight: '500',
  },
  wheelItemTextSelected: {
    fontSize: 22,
    color: '#4C8CFF',
    fontWeight: '700',
  },
  wheelSelectionOverlay: {
    position: 'absolute',
    top: WHEEL_ITEM_HEIGHT * 2,
    left: 0,
    right: 0,
    height: WHEEL_ITEM_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#1B2E4A',
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
  },
  saveButton: { 
    flexDirection: 'row', 
    backgroundColor: '#4C8CFF', 
    padding: 16, 
    borderRadius: 12, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginTop: 32,
    shadowColor: '#4C8CFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    backgroundColor: '#2B3B53',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: '600', 
    marginLeft: 8,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    padding: 16,
  },
  overlayBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: '#0F2339',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F2339',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 16,
    color: '#F5F7FF',
  },
  modalListContent: {
    paddingBottom: 20,
  },
  modalRow: {
    backgroundColor: '#0F2339',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalRowPressed: {
    backgroundColor: '#13263C',
  },
  modalRowText: {
    fontSize: 16,
    color: '#F5F7FF',
  },
  modalSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#1B2E4A',
    marginHorizontal: 16,
  },
  modalEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  modalEmptyStateText: {
    fontSize: 14,
    color: '#9AACD1',
  },
  modalCustomButton: {
    margin: 16,
    backgroundColor: '#4C8CFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCustomButtonDisabled: {
    backgroundColor: '#2B3B53',
  },
  modalCustomButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

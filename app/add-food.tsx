import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform, Keyboard, InputAccessoryView, KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFood } from '../contexts/FoodContext';
import { useSafeBack } from '../hooks/use-safe-back';

export default function AddFoodScreen() {
  const router = useRouter();
  const { addFood } = useFood();

  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameRef = React.useRef<TextInput>(null);
  const caloriesRef = React.useRef<TextInput>(null);
  const proteinRef = React.useRef<TextInput>(null);
  const carbsRef = React.useRef<TextInput>(null);
  const fatRef = React.useRef<TextInput>(null);
  const accessoryID = 'decimalAccessory';

  function normalizeDecimal(value: string): string {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }

  // Safe back: force replace to the Food tab to avoid any stack edge-cases
  const safeBack = useSafeBack('/food', { alwaysReplace: true });

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a food name');
      return;
    }
    
    if (!calories.trim() || parseFloat(calories) <= 0) {
      Alert.alert('Error', 'Please enter valid calories');
      return;
    }

    setSaving(true);
    try {
      const id = Date.now().toString();
      const foodEntry = { 
        id, 
        name: name.trim(), 
        calories: parseFloat(calories),
        protein: protein.trim() ? parseFloat(protein) : undefined,
        carbs: carbs.trim() ? parseFloat(carbs) : undefined,
        fat: fat.trim() ? parseFloat(fat) : undefined,
        date: date.toISOString() 
      };
      
      console.log('Saving food:', foodEntry);
      addFood(foodEntry);
      
      Alert.alert('Success', 'Meal logged successfully!', [
        { text: 'OK', onPress: () => safeBack() }
      ]);
    } catch (error) {
      console.error('Error saving food:', error);
      Alert.alert('Error', 'Failed to save meal. Please try again.');
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
        <Text style={styles.headerTitle}>Log Meal</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bounces
          contentInsetAdjustmentBehavior="always"
          onScrollBeginDrag={Keyboard.dismiss}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Food Name *</Text>
          <TextInput 
            style={styles.input} 
            value={name} 
            onChangeText={setName} 
            placeholder="e.g., Chicken Breast, Apple, Pasta"
            editable={!saving}
            ref={nameRef}
            returnKeyType="next"
            onSubmitEditing={() => caloriesRef.current?.focus()}
            blurOnSubmit={false}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Calories *</Text>
          <TextInput 
            style={styles.input} 
            value={calories} 
            onChangeText={(t) => setCalories(normalizeDecimal(t))} 
            inputMode="decimal"
            keyboardType="decimal-pad" 
            placeholder="e.g., 250"
            editable={!saving}
            ref={caloriesRef}
            returnKeyType="next"
            onSubmitEditing={() => proteinRef.current?.focus()}
            blurOnSubmit={false}
            inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
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
              editable={!saving}
              ref={proteinRef}
              returnKeyType="next"
              onSubmitEditing={() => carbsRef.current?.focus()}
              blurOnSubmit={false}
              inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
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
              editable={!saving}
              ref={carbsRef}
              returnKeyType="next"
              onSubmitEditing={() => fatRef.current?.focus()}
              blurOnSubmit={false}
              inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
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
              editable={!saving}
              ref={fatRef}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
            />
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Date & Time</Text>
          <TouchableOpacity 
            onPress={() => setShowPicker(true)} 
            style={styles.dateInput}
            disabled={saving}
          >
            <Text style={styles.dateText}>{date.toLocaleString()}</Text>
            <Ionicons name="calendar-outline" size={20} color="#8E8E93" />
          </TouchableOpacity>
        </View>

        {showPicker && (
          <DateTimePicker
            value={date}
            mode="datetime"
            display="default"
            onChange={(event: any, selectedDate?: Date) => { 
              setDate(selectedDate || date); 
              setShowPicker(false); 
            }}
          />
        )}

        <TouchableOpacity 
          style={[styles.saveButton, (!name.trim() || !calories.trim() || saving) && styles.saveButtonDisabled]} 
          onPress={onSave} 
          disabled={!name.trim() || !calories.trim() || saving}
        >
          {saving ? (
            <Ionicons name="hourglass" size={20} color="#fff" />
          ) : (
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
          )}
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving...' : 'Save Meal'}
          </Text>
        </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    padding: 20,
  },
  flex: { flex: 1 },
  inputContainer: {
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  thirdWidth: {
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
  dateInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1, 
    borderColor: '#E5E5EA', 
    borderRadius: 12, 
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 16,
    color: '#1C1C1E',
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

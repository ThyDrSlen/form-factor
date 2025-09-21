import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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

      <View style={styles.content}>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Food Name *</Text>
          <TextInput 
            style={styles.input} 
            value={name} 
            onChangeText={setName} 
            placeholder="e.g., Chicken Breast, Apple, Pasta"
            editable={!saving}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Calories *</Text>
          <TextInput 
            style={styles.input} 
            value={calories} 
            onChangeText={setCalories} 
            keyboardType="decimal-pad" 
            placeholder="e.g., 250"
            editable={!saving}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputContainer, styles.thirdWidth]}>
            <Text style={styles.label}>Protein (g)</Text>
            <TextInput 
              style={styles.input} 
              value={protein} 
              onChangeText={setProtein} 
              keyboardType="decimal-pad" 
              placeholder="Optional"
              editable={!saving}
            />
          </View>

          <View style={[styles.inputContainer, styles.thirdWidth]}>
            <Text style={styles.label}>Carbs (g)</Text>
            <TextInput 
              style={styles.input} 
              value={carbs} 
              onChangeText={setCarbs} 
              keyboardType="decimal-pad" 
              placeholder="Optional"
              editable={!saving}
            />
          </View>

          <View style={[styles.inputContainer, styles.thirdWidth]}>
            <Text style={styles.label}>Fat (g)</Text>
            <TextInput 
              style={styles.input} 
              value={fat} 
              onChangeText={setFat} 
              keyboardType="decimal-pad" 
              placeholder="Optional"
              editable={!saving}
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
      </View>
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

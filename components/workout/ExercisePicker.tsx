/**
 * ExercisePicker Component
 *
 * Bottom sheet for searching and selecting exercises from the local
 * exercises table. Supports custom exercise creation.
 */

import React, { useEffect, useMemo, useState, useCallback, forwardRef } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { localDB } from '@/lib/services/database/local-db';
import { genericLocalUpsert } from '@/lib/services/database/generic-sync';
import type { Exercise } from '@/lib/types/workout-session';

interface ExercisePickerProps {
  onSelect: (exerciseId: string) => void;
  onClose: () => void;
}

const ExercisePicker = forwardRef<BottomSheet, ExercisePickerProps>(
  ({ onSelect, onClose }, ref) => {
    const snapPoints = useMemo(() => ['70%'], []);
    const [exercises, setExercises] = useState<Exercise[]>([]);
    const [search, setSearch] = useState('');

    // Load exercises from SQLite
    useEffect(() => {
      loadExercises();
    }, []);

    const loadExercises = async () => {
      const db = localDB.db;
      if (!db) return;
      const rows = await db.getAllAsync<Exercise>(
        'SELECT * FROM exercises ORDER BY name ASC',
      );
      setExercises(rows);
    };

    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return exercises;
      return exercises.filter((e) => e.name.toLowerCase().includes(q));
    }, [search, exercises]);

    const handleSelect = useCallback(
      (exerciseId: string) => {
        onSelect(exerciseId);
        onClose();
      },
      [onSelect, onClose],
    );

    const handleAddCustom = useCallback(async () => {
      const name = search.trim();
      if (!name) return;

      const id = Crypto.randomUUID();
      const now = new Date().toISOString();

      await genericLocalUpsert('exercises', 'id', {
        id,
        name,
        category: null,
        muscle_group: null,
        is_compound: 0,
        is_timed: 0,
        is_system: 0,
        created_by: null, // Will be filled on sync
        synced: 0,
        updated_at: now,
        created_at: now,
      }, 0);

      await loadExercises();
      handleSelect(id);
    }, [search, handleSelect]);

    const renderItem = useCallback(
      ({ item }: { item: Exercise }) => (
        <TouchableOpacity
          style={styles.pickerItem}
          onPress={() => handleSelect(item.id)}
        >
          <View>
            <Text style={styles.pickerItemName}>{item.name}</Text>
            {item.category && (
              <Text style={styles.pickerItemCategory}>{item.category}</Text>
            )}
          </View>
          <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      ),
      [handleSelect],
    );

    const showCustomBtn = search.trim().length > 0 && filtered.length === 0;

    return (
      <BottomSheet
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        backgroundStyle={{ backgroundColor: colors.background }}
        handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
      >
        <BottomSheetView style={[styles.sheetContainer, { flex: 1 }]}>
          <Text style={[styles.sheetTitle, { fontSize: 16, fontFamily: 'Lexend_700Bold', color: colors.textPrimary }]}>
            Add Exercise
          </Text>

          {/* Search */}
          <View style={styles.pickerSearch}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.pickerSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search exercises..."
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              autoFocus
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Custom exercise button */}
          {showCustomBtn && (
            <TouchableOpacity style={styles.pickerCustomBtn} onPress={handleAddCustom}>
              <Ionicons name="add" size={20} color={colors.accent} />
              <Text style={styles.pickerCustomText}>Add &quot;{search.trim()}&quot;</Text>
            </TouchableOpacity>
          )}

          {/* Exercise list */}
          <BottomSheetFlatList
            data={filtered}
            keyExtractor={(item: Exercise) => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
          />
        </BottomSheetView>
      </BottomSheet>
    );
  },
);

ExercisePicker.displayName = 'ExercisePicker';
export default ExercisePicker;

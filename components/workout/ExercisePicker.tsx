/**
 * ExercisePicker Component
 *
 * Bottom sheet for searching and selecting exercises from the local
 * exercises table. Supports custom exercise creation.
 */

import React, { useEffect, useMemo, useState, useCallback, forwardRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity } from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { localDB } from '@/lib/services/database/local-db';
import { genericLocalUpsert } from '@/lib/services/database/generic-sync';
import { resolveExerciseKey } from '@/lib/services/form-session-history-lookup';
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

    // A13: group results into supported (form-tracking model available) vs
    // coming-soon (free-log only) so the "Form-tracked" badge on the scan
    // tab isn't a surprise when the user later runs the set.
    const grouped = useMemo(() => {
      const supported: Exercise[] = [];
      const comingSoon: Exercise[] = [];
      for (const ex of filtered) {
        if (resolveExerciseKey(ex.name) != null) {
          supported.push(ex);
        } else {
          comingSoon.push(ex);
        }
      }
      return { supported, comingSoon };
    }, [filtered]);

    type SectionRow =
      | { kind: 'header'; id: string; label: string; count: number; form: boolean }
      | { kind: 'item'; id: string; exercise: Exercise; form: boolean };

    const rows: SectionRow[] = useMemo(() => {
      const out: SectionRow[] = [];
      if (grouped.supported.length > 0) {
        out.push({
          kind: 'header',
          id: 'header-supported',
          label: 'Form-tracked',
          count: grouped.supported.length,
          form: true,
        });
        for (const ex of grouped.supported) {
          out.push({ kind: 'item', id: ex.id, exercise: ex, form: true });
        }
      }
      if (grouped.comingSoon.length > 0) {
        out.push({
          kind: 'header',
          id: 'header-coming',
          label: 'Coming soon — free log',
          count: grouped.comingSoon.length,
          form: false,
        });
        for (const ex of grouped.comingSoon) {
          out.push({ kind: 'item', id: ex.id, exercise: ex, form: false });
        }
      }
      return out;
    }, [grouped]);

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
      ({ item }: { item: SectionRow }) => {
        if (item.kind === 'header') {
          return (
            <View
              style={pickerSectionStyles.header}
              testID={`exercise-picker-section-${item.form ? 'supported' : 'coming-soon'}`}
            >
              <View style={pickerSectionStyles.headerRow}>
                <Ionicons
                  name={item.form ? 'videocam' : 'time-outline'}
                  size={14}
                  color={item.form ? '#4C8CFF' : '#9AACD1'}
                />
                <Text
                  style={[
                    pickerSectionStyles.headerText,
                    item.form ? pickerSectionStyles.headerTextSupported : null,
                  ]}
                >
                  {item.label}
                </Text>
                <Text style={pickerSectionStyles.headerCount}>({item.count})</Text>
              </View>
            </View>
          );
        }
        const ex = item.exercise;
        return (
          <TouchableOpacity
            style={[
              styles.pickerItem,
              !item.form ? pickerSectionStyles.itemComingSoon : null,
            ]}
            onPress={() => handleSelect(ex.id)}
          >
            <View style={{ flex: 1 }}>
              <View style={pickerSectionStyles.nameRow}>
                <Text style={styles.pickerItemName}>{ex.name}</Text>
                {item.form ? (
                  <View
                    style={pickerSectionStyles.formBadge}
                    testID={`exercise-picker-form-badge-${ex.id}`}
                  >
                    <Ionicons name="videocam" size={10} color="#4C8CFF" />
                    <Text style={pickerSectionStyles.formBadgeText}>Form</Text>
                  </View>
                ) : null}
              </View>
              {ex.category && (
                <Text style={styles.pickerItemCategory}>{ex.category}</Text>
              )}
            </View>
            <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
          </TouchableOpacity>
        );
      },
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

          {/* Exercise list — grouped by form-tracking support (A13) */}
          <BottomSheetFlatList
            data={rows}
            keyExtractor={(item: SectionRow) => item.id}
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

const pickerSectionStyles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    color: '#9AACD1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTextSupported: {
    color: '#4C8CFF',
  },
  headerCount: {
    color: '#6781A6',
    fontSize: 11,
    fontWeight: '600',
  },
  itemComingSoon: {
    opacity: 0.75,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  formBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(76, 140, 255, 0.4)',
  },
  formBadgeText: {
    color: '#4C8CFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});

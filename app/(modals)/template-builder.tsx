/**
 * TemplateBuilderScreen
 *
 * Create and edit workout templates with exercises and planned sets.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import BottomSheet from '@gorhom/bottom-sheet';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';

import { tabColors } from '@/styles/tabs/_tab-theme';
import { sessionStyles, colors } from '@/styles/workout-session.styles';
import { localDB } from '@/lib/services/database/local-db';
import { genericLocalUpsert, genericSoftDelete } from '@/lib/services/database/generic-sync';
import ExercisePicker from '@/components/workout/ExercisePicker';
import type {
  Exercise,
  GoalProfile,
  SetType,
  WorkoutTemplate,
  WorkoutTemplateExercise,
  WorkoutTemplateSet,
} from '@/lib/types/workout-session';

interface TemplateExerciseRow extends WorkoutTemplateExercise {
  exercise?: Exercise;
  sets: WorkoutTemplateSet[];
}

const GOAL_OPTIONS: { value: GoalProfile; label: string }[] = [
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'strength', label: 'Strength' },
  { value: 'power', label: 'Power' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'mixed', label: 'Mixed' },
];

export default function TemplateBuilderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ templateId?: string }>();
  const exercisePickerRef = useRef<BottomSheet>(null);

  const [templateId] = useState(() => params.templateId ?? Crypto.randomUUID());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goalProfile, setGoalProfile] = useState<GoalProfile>('hypertrophy');
  const [exercises, setExercises] = useState<TemplateExerciseRow[]>([]);
  const [isEditing] = useState(!!params.templateId);

  useEffect(() => {
    if (params.templateId) {
      loadTemplate(params.templateId);
    }
  }, []);

  const loadTemplate = async (id: string) => {
    const db = localDB.db;
    if (!db) return;

    const templates = await db.getAllAsync<WorkoutTemplate>(
      'SELECT * FROM workout_templates WHERE id = ? AND deleted = 0',
      [id],
    );
    if (templates.length === 0) return;
    const t = templates[0];
    setName(t.name);
    setDescription(t.description ?? '');
    setGoalProfile(t.goal_profile);

    const exRows = await db.getAllAsync<WorkoutTemplateExercise>(
      'SELECT * FROM workout_template_exercises WHERE template_id = ? AND deleted = 0 ORDER BY sort_order ASC',
      [id],
    );

    const result: TemplateExerciseRow[] = [];
    for (const ex of exRows) {
      const exerciseRows = await db.getAllAsync<Exercise>(
        'SELECT * FROM exercises WHERE id = ?',
        [ex.exercise_id],
      );
      const setRows = await db.getAllAsync<WorkoutTemplateSet>(
        'SELECT * FROM workout_template_sets WHERE template_exercise_id = ? AND deleted = 0 ORDER BY sort_order ASC',
        [ex.id],
      );
      result.push({
        ...ex,
        exercise: exerciseRows[0] ?? undefined,
        sets: setRows,
      });
    }
    setExercises(result);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a template name.');
      return;
    }

    const now = new Date().toISOString();

    await genericLocalUpsert('workout_templates', 'id', {
      id: templateId,
      name: name.trim(),
      description: description.trim() || null,
      goal_profile: goalProfile,
      is_public: 0,
      share_slug: null,
      synced: 0,
      deleted: 0,
      updated_at: now,
      created_at: now,
    }, 0);

    // Save exercises and sets
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      await genericLocalUpsert('workout_template_exercises', 'id', {
        id: ex.id,
        template_id: templateId,
        exercise_id: ex.exercise_id,
        sort_order: i,
        notes: ex.notes,
        default_rest_seconds: ex.default_rest_seconds,
        default_tempo: ex.default_tempo,
        synced: 0,
        deleted: 0,
        updated_at: now,
        created_at: now,
      }, 0);

      for (let j = 0; j < ex.sets.length; j++) {
        const s = ex.sets[j];
        await genericLocalUpsert('workout_template_sets', 'id', {
          id: s.id,
          template_exercise_id: ex.id,
          sort_order: j,
          set_type: s.set_type,
          target_reps: s.target_reps,
          target_seconds: s.target_seconds,
          target_weight: s.target_weight,
          target_rpe: s.target_rpe,
          rest_seconds_override: s.rest_seconds_override,
          notes: s.notes,
          synced: 0,
          deleted: 0,
          updated_at: now,
          created_at: now,
        }, 0);
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const handleAddExercise = (exerciseId: string) => {
    const loadAndAdd = async () => {
      const db = localDB.db;
      if (!db) return;

      const exRows = await db.getAllAsync<Exercise>(
        'SELECT * FROM exercises WHERE id = ?',
        [exerciseId],
      );

      const newEx: TemplateExerciseRow = {
        id: Crypto.randomUUID(),
        template_id: templateId,
        exercise_id: exerciseId,
        sort_order: exercises.length,
        notes: null,
        default_rest_seconds: null,
        default_tempo: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        exercise: exRows[0] ?? undefined,
        sets: [
          {
            id: Crypto.randomUUID(),
            template_exercise_id: '', // will be set properly
            sort_order: 0,
            set_type: 'normal',
            target_reps: 8,
            target_seconds: null,
            target_weight: null,
            target_rpe: null,
            rest_seconds_override: null,
            notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
      // Fix the template_exercise_id reference
      newEx.sets[0].template_exercise_id = newEx.id;

      setExercises((prev) => [...prev, newEx]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    loadAndAdd();
  };

  const handleAddSet = (exerciseIdx: number) => {
    setExercises((prev) => {
      const updated = [...prev];
      const ex = { ...updated[exerciseIdx] };
      const prevSet = ex.sets[ex.sets.length - 1];
      ex.sets = [
        ...ex.sets,
        {
          id: Crypto.randomUUID(),
          template_exercise_id: ex.id,
          sort_order: ex.sets.length,
          set_type: 'normal',
          target_reps: prevSet?.target_reps ?? 8,
          target_seconds: prevSet?.target_seconds ?? null,
          target_weight: prevSet?.target_weight ?? null,
          target_rpe: null,
          rest_seconds_override: null,
          notes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      updated[exerciseIdx] = ex;
      return updated;
    });
  };

  const handleRemoveExercise = (idx: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <SafeAreaView style={builderStyles.container} edges={['top']}>
      {/* Header */}
      <View style={builderStyles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={builderStyles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={builderStyles.headerTitle}>
          {isEditing ? 'Edit Template' : 'New Template'}
        </Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={builderStyles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <Text style={builderStyles.label}>Name</Text>
        <TextInput
          style={builderStyles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Push Day"
          placeholderTextColor={tabColors.textSecondary}
        />

        {/* Description */}
        <Text style={builderStyles.label}>Description</Text>
        <TextInput
          style={[builderStyles.input, { minHeight: 60 }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional description"
          placeholderTextColor={tabColors.textSecondary}
          multiline
        />

        {/* Goal Profile */}
        <Text style={builderStyles.label}>Goal Profile</Text>
        <View style={sessionStyles.segmentedControl}>
          {GOAL_OPTIONS.map((g) => (
            <TouchableOpacity
              key={g.value}
              style={[
                sessionStyles.segmentButton,
                goalProfile === g.value && sessionStyles.segmentButtonActive,
              ]}
              onPress={() => setGoalProfile(g.value)}
            >
              <Text
                style={[
                  sessionStyles.segmentText,
                  goalProfile === g.value && sessionStyles.segmentTextActive,
                  { fontSize: 11 },
                ]}
              >
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Exercises */}
        <Text style={[builderStyles.label, { marginTop: 24 }]}>Exercises</Text>

        {exercises.map((ex, exIdx) => (
          <View key={ex.id} style={builderStyles.exerciseCard}>
            <View style={builderStyles.exerciseCardHeader}>
              <Text style={builderStyles.exerciseName}>
                {ex.exercise?.name ?? 'Exercise'}
              </Text>
              <TouchableOpacity onPress={() => handleRemoveExercise(exIdx)}>
                <Ionicons name="trash-outline" size={18} color={tabColors.error} />
              </TouchableOpacity>
            </View>

            {/* Set headers */}
            <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={[builderStyles.setLabel, { flex: 0.3 }]}>Set</Text>
              <Text style={[builderStyles.setLabel, { flex: 1 }]}>Reps</Text>
              <Text style={[builderStyles.setLabel, { flex: 1 }]}>Weight</Text>
            </View>

            {ex.sets.map((s, sIdx) => (
              <View key={s.id} style={builderStyles.setRow}>
                <Text style={[builderStyles.setNum, { flex: 0.3 }]}>{sIdx + 1}</Text>
                <TextInput
                  style={[builderStyles.setInput, { flex: 1 }]}
                  value={s.target_reps != null ? String(s.target_reps) : ''}
                  onChangeText={(text) => {
                    const val = text ? parseInt(text, 10) : null;
                    setExercises((prev) => {
                      const u = [...prev];
                      const uEx = { ...u[exIdx] };
                      uEx.sets = [...uEx.sets];
                      uEx.sets[sIdx] = { ...uEx.sets[sIdx], target_reps: val };
                      u[exIdx] = uEx;
                      return u;
                    });
                  }}
                  keyboardType="numeric"
                  placeholder="8"
                  placeholderTextColor={tabColors.textSecondary}
                />
                <TextInput
                  style={[builderStyles.setInput, { flex: 1 }]}
                  value={s.target_weight != null ? String(s.target_weight) : ''}
                  onChangeText={(text) => {
                    const val = text ? parseFloat(text) : null;
                    setExercises((prev) => {
                      const u = [...prev];
                      const uEx = { ...u[exIdx] };
                      uEx.sets = [...uEx.sets];
                      uEx.sets[sIdx] = { ...uEx.sets[sIdx], target_weight: val };
                      u[exIdx] = uEx;
                      return u;
                    });
                  }}
                  keyboardType="numeric"
                  placeholder="lb"
                  placeholderTextColor={tabColors.textSecondary}
                />
              </View>
            ))}

            <TouchableOpacity
              style={builderStyles.addSetBtn}
              onPress={() => handleAddSet(exIdx)}
            >
              <Ionicons name="add" size={16} color={tabColors.accent} />
              <Text style={builderStyles.addSetText}>Add Set</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add Exercise */}
        <TouchableOpacity
          style={sessionStyles.addExerciseBtn}
          onPress={() => exercisePickerRef.current?.expand()}
        >
          <Ionicons name="add-circle-outline" size={22} color={tabColors.accent} />
          <Text style={sessionStyles.addExerciseText}>Add Exercise</Text>
        </TouchableOpacity>
      </ScrollView>

      <ExercisePicker
        ref={exercisePickerRef}
        onSelect={handleAddExercise}
        onClose={() => exercisePickerRef.current?.close()}
      />
    </SafeAreaView>
  );
}

const builderStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tabColors.border,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  saveText: {
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.accent,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textSecondary,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: tabColors.border,
    padding: 12,
    fontSize: 15,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textPrimary,
  },
  exerciseCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    marginTop: 12,
    overflow: 'hidden',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tabColors.border,
  },
  exerciseName: {
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  setLabel: {
    fontSize: 11,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textSecondary,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  setNum: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textSecondary,
    textAlign: 'center',
  },
  setInput: {
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
    textAlign: 'center',
    padding: 4,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tabColors.border,
  },
  addSetText: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.accent,
  },
});

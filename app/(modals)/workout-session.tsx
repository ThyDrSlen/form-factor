/**
 * WorkoutSessionScreen
 *
 * Main screen for the live workout session runner.
 * Supports both starting from a template and ad-hoc sessions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import BottomSheet from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';

import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { useSessionRunner } from '@/lib/stores/session-runner';
import type { WorkoutSession, WorkoutSessionSet, SetType } from '@/lib/types/workout-session';

import ExerciseCard from '@/components/workout/ExerciseCard';
import TimerPill from '@/components/workout/TimerPill';
import SessionMetaCard from '@/components/workout/SessionMetaCard';
import SetActionSheet from '@/components/workout/SetActionSheet';
import ExerciseActionSheet from '@/components/workout/ExerciseActionSheet';
import RestTimerSheet from '@/components/workout/RestTimerSheet';
import ExercisePicker from '@/components/workout/ExercisePicker';
import SetNotesModal from '@/components/workout/SetNotesModal';

export default function WorkoutSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ templateId?: string; goalProfile?: string }>();

  // Zustand store
  const activeSession = useSessionRunner((s) => s.activeSession);
  const exercises = useSessionRunner((s) => s.exercises);
  const sets = useSessionRunner((s) => s.sets);
  const isLoading = useSessionRunner((s) => s.isLoading);
  const startSession = useSessionRunner((s) => s.startSession);
  const addExercise = useSessionRunner((s) => s.addExercise);
  const addSet = useSessionRunner((s) => s.addSet);
  const updateSet = useSessionRunner((s) => s.updateSet);
  const completeSet = useSessionRunner((s) => s.completeSet);
  const finishSession = useSessionRunner((s) => s.finishSession);
  const removeSet = useSessionRunner((s) => s.removeSet);
  const removeExercise = useSessionRunner((s) => s.removeExercise);
  const duplicateSet = useSessionRunner((s) => s.duplicateSet);
  const updateSetType = useSessionRunner((s) => s.updateSetType);
  const duplicateExercise = useSessionRunner((s) => s.duplicateExercise);
  const loadActiveSession = useSessionRunner((s) => s.loadActiveSession);

  // Bottom sheet refs
  const setActionRef = useRef<BottomSheet>(null);
  const exerciseActionRef = useRef<BottomSheet>(null);
  const restTimerRef = useRef<BottomSheet>(null);
  const exercisePickerRef = useRef<BottomSheet>(null);

  // Active sheet targets
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [notesModalSetId, setNotesModalSetId] = useState<string | null>(null);

  // Initialize session on mount
  useEffect(() => {
    const init = async () => {
      // Try to load an existing active session first
      await loadActiveSession();

      // If no active session, start a new one
      const current = useSessionRunner.getState().activeSession;
      if (!current) {
        await startSession({
          templateId: params.templateId,
          goalProfile: (params.goalProfile as any) ?? 'hypertrophy',
        });
      }
    };
    init();
  }, []);

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleUpdateSession = useCallback(
    async (fields: Partial<WorkoutSession>) => {
      if (!activeSession) return;
      const db = (await import('@/lib/services/database/local-db')).localDB.db;
      if (!db) return;

      const entries = Object.entries(fields).filter(([k]) => k !== 'id');
      if (entries.length === 0) return;

      const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) => (v === undefined ? null : v));

      await db.runAsync(
        `UPDATE workout_sessions SET ${setClauses}, synced = 0, updated_at = ? WHERE id = ?`,
        [...values, new Date().toISOString(), activeSession.id],
      );

      // Update in-memory
      useSessionRunner.setState({
        activeSession: { ...activeSession, ...fields },
      });
    },
    [activeSession],
  );

  const handleFinish = useCallback(() => {
    Alert.alert('Finish Workout', 'Are you sure you want to finish this workout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        style: 'default',
        onPress: async () => {
          await finishSession();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
      },
    ]);
  }, [finishSession, router]);

  const handleAddExercise = useCallback(() => {
    exercisePickerRef.current?.expand();
  }, []);

  const handleExerciseSelected = useCallback(
    async (exerciseId: string) => {
      await addExercise(exerciseId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [addExercise],
  );

  const handleAddSet = useCallback(
    async (sessionExerciseId: string) => {
      await addSet(sessionExerciseId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [addSet],
  );

  const handleUpdateSet = useCallback(
    (setId: string, fields: Partial<WorkoutSessionSet>) => {
      updateSet(setId, fields);
    },
    [updateSet],
  );

  const handleCompleteSet = useCallback(
    async (setId: string) => {
      await completeSet(setId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [completeSet],
  );

  const handleSetMenuPress = useCallback((setId: string) => {
    setActiveSetId(setId);
    setActionRef.current?.expand();
  }, []);

  const handleNotesPress = useCallback((setId: string) => {
    setNotesModalSetId(setId);
  }, []);

  const handleExerciseMenuPress = useCallback((sessionExerciseId: string) => {
    setActiveExerciseId(sessionExerciseId);
    exerciseActionRef.current?.expand();
  }, []);

  const handleTimerPillPress = useCallback(() => {
    restTimerRef.current?.expand();
  }, []);

  // Get the active set for the set action sheet
  const activeSetData = (() => {
    if (!activeSetId) return null;
    for (const [, exSets] of Object.entries(sets)) {
      const found = exSets.find((s) => s.id === activeSetId);
      if (found) return found;
    }
    return null;
  })();

  const activeExerciseData = activeExerciseId
    ? exercises.find((e) => e.id === activeExerciseId)
    : null;

  // =========================================================================
  // Date title
  // =========================================================================
  const dateTitle = activeSession
    ? new Date(activeSession.started_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : '';

  // =========================================================================
  // Render
  // =========================================================================

  if (isLoading || !activeSession) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.textSecondary, fontFamily: 'Lexend_400Regular' }}>
            Loading...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.finishButton} onPress={handleFinish}>
              <Ionicons name="checkmark" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <Text style={styles.headerTitle}>{dateTitle}</Text>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerButton} onPress={handleTimerPillPress}>
              <Ionicons name="timer-outline" size={20} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Timer Pill */}
        <TimerPill onPress={handleTimerPillPress} />

        {/* Scrollable content */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Session Meta Card */}
          <SessionMetaCard
            session={activeSession}
            onUpdateSession={handleUpdateSession}
          />

          {/* Exercise Cards */}
          {exercises.map((ex) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              sets={sets[ex.id] ?? []}
              onAddSet={handleAddSet}
              onUpdateSet={handleUpdateSet}
              onCompleteSet={handleCompleteSet}
              onSetMenuPress={handleSetMenuPress}
              onExerciseMenuPress={handleExerciseMenuPress}
              onNotesPress={handleNotesPress}
            />
          ))}

          {/* Add Exercise Button */}
          <TouchableOpacity style={styles.addExerciseBtn} onPress={handleAddExercise}>
            <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
            <Text style={styles.addExerciseText}>Add Exercise</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Sheets */}
      {activeSetData && (
        <SetActionSheet
          ref={setActionRef}
          currentSetType={activeSetData.set_type}
          onChangeSetType={(type: SetType) => {
            if (activeSetId) updateSetType(activeSetId, type);
          }}
          onCopyOnce={() => {
            if (activeSetId) {
              duplicateSet(activeSetId, 1);
              setActionRef.current?.close();
            }
          }}
          onCopyMultiple={(count) => {
            if (activeSetId) {
              duplicateSet(activeSetId, count);
              setActionRef.current?.close();
              setActiveSetId(null);
            }
          }}
          onDelete={() => {
            if (activeSetId) {
              removeSet(activeSetId);
              setActionRef.current?.close();
            }
          }}
          onClose={() => {
            setActiveSetId(null);
            setActionRef.current?.close();
          }}
        />
      )}

      {activeExerciseData && (
        <ExerciseActionSheet
          ref={exerciseActionRef}
          exerciseName={activeExerciseData.exercise?.name ?? 'Exercise'}
          onCopy={() => {
            if (activeExerciseId) {
              duplicateExercise(activeExerciseId);
              exerciseActionRef.current?.close();
            }
          }}
          onDelete={() => {
            if (activeExerciseId) {
              removeExercise(activeExerciseId);
              exerciseActionRef.current?.close();
            }
          }}
          onClose={() => {
            setActiveExerciseId(null);
            exerciseActionRef.current?.close();
          }}
        />
      )}

      <RestTimerSheet
        ref={restTimerRef}
        onClose={() => restTimerRef.current?.close()}
      />

      <ExercisePicker
        ref={exercisePickerRef}
        onSelect={handleExerciseSelected}
        onClose={() => exercisePickerRef.current?.close()}
      />

      {/* Set notes modal */}
      {notesModalSetId && (() => {
        const targetSet = Object.values(sets).flat().find((s) => s.id === notesModalSetId);
        return (
          <SetNotesModal
            visible={!!notesModalSetId}
            notes={targetSet?.notes ?? ''}
            onSave={(notes) => {
              if (notesModalSetId) updateSet(notesModalSetId, { notes });
            }}
            onClose={() => setNotesModalSetId(null)}
          />
        );
      })()}
    </SafeAreaView>
  );
}

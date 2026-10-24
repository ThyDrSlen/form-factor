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

import { sessionStyles as styles, colors } from '@/features/workouts/styles/workout-session.styles';
import { useToast } from '@/contexts/ToastContext';
import { useSessionRunner } from '@/lib/stores/session-runner';
import type { GoalProfile, WorkoutSession, WorkoutSessionSet, SetType } from '@/lib/types/workout-session';

import ExerciseCard from '@/features/workouts/components/ExerciseCard';
import TimerPill from '@/features/workouts/components/TimerPill';
import SessionMetaCard from '@/features/workouts/components/SessionMetaCard';
import SetActionSheet from '@/features/workouts/components/SetActionSheet';
import ExerciseActionSheet from '@/features/workouts/components/ExerciseActionSheet';
import RestTimerSheet from '@/features/workouts/components/RestTimerSheet';
import ExercisePicker from '@/features/workouts/components/ExercisePicker';
import SetNotesModal from '@/features/workouts/components/SetNotesModal';
import SessionPauseButton from '@/features/workouts/components/SessionPauseButton';
import SessionPausedOverlay from '@/features/workouts/components/SessionPausedOverlay';

const GOAL_PROFILES: GoalProfile[] = ['hypertrophy', 'strength', 'power', 'endurance', 'mixed'];

function parseGoalProfile(goalProfile?: string): GoalProfile {
  return GOAL_PROFILES.includes(goalProfile as GoalProfile) ? (goalProfile as GoalProfile) : 'hypertrophy';
}

export default function WorkoutSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ templateId?: string; goalProfile?: string }>();
  const { show: showToast } = useToast();

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

  const initializingRef = useRef(false);
  const initializedRef = useRef(false);
  const [initializationError, setInitializationError] = useState(false);
  const initializeSession = useCallback(async () => {
    if (initializingRef.current || initializedRef.current) return;
    initializingRef.current = true;
    setInitializationError(false);
    try {
      await loadActiveSession();
      const current = useSessionRunner.getState();
      if (current.error) throw new Error(current.error);
      if (!current.activeSession) {
        await startSession({
          templateId: params.templateId,
          goalProfile: parseGoalProfile(params.goalProfile),
        });
      }
      if (!useSessionRunner.getState().activeSession) throw new Error('No active session');
      initializedRef.current = true;
    } catch {
      setInitializationError(true);
    } finally {
      initializingRef.current = false;
    }
  }, [loadActiveSession, params.goalProfile, params.templateId, startSession]);

  useEffect(() => {
    void initializeSession();
  }, [initializeSession]);

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

  const finishingRef = useRef(false);
  const confirmingRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const handleFinish = useCallback(() => {
    if (finishingRef.current || confirmingRef.current || !activeSession) return;
    confirmingRef.current = true;
    const sessionId = activeSession.id;
    Alert.alert('Finish Workout', 'Save this workout and review your completed sets?', [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirmingRef.current = false; } },
      {
        text: 'Finish',
        style: 'default',
        onPress: async () => {
          confirmingRef.current = false;
          if (finishingRef.current) return;
          if (useSessionRunner.getState().activeSession?.id !== sessionId) {
            showToast('The active workout changed. Reopen Finish for the current workout.', { type: 'error' });
            return;
          }
          finishingRef.current = true;
          setIsFinishing(true);
          try {
            await finishSession();
            if (useSessionRunner.getState().activeSession?.id === sessionId) {
              throw new Error('Session was not saved');
            }
          } catch {
            finishingRef.current = false;
            setIsFinishing(false);
            showToast('Could not save workout. Your session is still open — tap Finish to retry.', { type: 'error' });
            return;
          }
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          showToast('Workout saved!', { type: 'success' });
          router.replace(`/(modals)/session-history?sessionId=${encodeURIComponent(sessionId)}`);
        },
      },
    ], { onDismiss: () => { confirmingRef.current = false; } });
  }, [activeSession, finishSession, router, showToast]);

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
    ? new Date(activeSession.started_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '';

  // =========================================================================
  // Render
  // =========================================================================

  if (isLoading || !activeSession || initializationError || isFinishing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontFamily: 'Lexend_400Regular' }}>
            {initializationError ? 'Could not open your workout. Please retry.' : isFinishing ? 'Saving workout…' : 'Opening your workout…'}
          </Text>
          {initializationError ? (
            <TouchableOpacity style={styles.addExerciseBtn} onPress={() => void initializeSession()}
              accessibilityRole="button" accessibilityLabel="Retry opening workout">
              <Text style={styles.addExerciseText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
          {!isFinishing ? (
            <TouchableOpacity style={styles.addExerciseBtn} onPress={() => router.back()}
              accessibilityRole="button" accessibilityLabel="Close workout">
              <Text style={styles.addExerciseText}>Close</Text>
            </TouchableOpacity>
          ) : null}
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
            <TouchableOpacity style={styles.finishButton} onPress={handleFinish}
              accessibilityRole="button" accessibilityLabel="Finish workout"
              accessibilityState={{ disabled: isFinishing, busy: isFinishing }} disabled={isFinishing}>
              <Ionicons name="checkmark" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <Text style={styles.headerTitle}>{dateTitle}</Text>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerButton} onPress={handleTimerPillPress}>
              <Ionicons name="timer-outline" size={20} color={colors.accent} />
            </TouchableOpacity>
            <SessionPauseButton />
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

      {/* Paused overlay — renders null when the session is not paused. */}
      <SessionPausedOverlay onEndSession={handleFinish} />
    </SafeAreaView>
  );
}

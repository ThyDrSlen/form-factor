import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { DeleteAction } from '@/components';
import { AskCoachCTA } from '@/components/form-tracking/AskCoachCTA';
import { FormQualityBadgeRow } from '@/components/workouts/FormQualityBadgeRow';
import { OverloadAnalyticsCard } from '@/components/workouts/OverloadAnalyticsCard';
import { WorkoutCardSkeleton } from '@/components/workouts/WorkoutCardSkeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useUnits } from '@/contexts/UnitsContext';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import { getMostRecentAvgFqi } from '@/lib/services/form-session-history-lookup';
import {
  isOverloadCardEnabled,
  isProgressionPlanEnabled,
} from '@/lib/services/progression-flags';
import { exportSession } from '@/lib/services/session-export-service';
import { isWorkoutCoachRecallEnabled } from '@/lib/services/workout-coach-recall-flag';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    FlatList,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useWorkouts, type Workout } from '../../contexts/WorkoutsContext';
import { useToast } from '../../contexts/ToastContext';
import { styles } from '../../styles/tabs/_workouts.styles';

const buildWorkoutShareMessage = (workout: Workout, weightLabel: string): string => {
  const workoutDate = workout.date ? new Date(workout.date) : null;
  const lines: string[] = [
    `Workout: ${workout.exercise}`,
    workoutDate
      ? `Date: ${workoutDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : null,
    `Sets: ${workout.sets}`,
    typeof workout.reps === 'number' && workout.reps > 0 ? `Reps: ${workout.reps}` : null,
    typeof workout.weight === 'number' && workout.weight > 0 ? `Weight: ${workout.weight} ${weightLabel}` : null,
    typeof workout.duration === 'number' && workout.duration > 0 ? `Duration: ${workout.duration} min` : null,
  ].filter((line): line is string => Boolean(line));

  return [...lines, '', 'Shared from Form Factor'].join('\n');
};

export default function WorkoutsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { getWeightLabel } = useUnits();
  const { workouts, loading, refreshWorkouts, deleteWorkout } = useWorkouts();
  const { show: showToast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  // Per-exercise most-recent FQI (issue #494, item 4). Lazily populated
  // from form-session-history; missing entries render no badge.
  const [formQualityByExercise, setFormQualityByExercise] = useState<
    Record<string, number | null>
  >({});
  // Wave-25 master flag — when off, the per-row AskCoachCTA is not
  // rendered. Read once on mount to match other flag consumers.
  const coachRecallEnabled = useMemo(() => isWorkoutCoachRecallEnabled(), []);

  const handleAskCoachAboutWorkout = useCallback(
    (workoutId: string) => {
      Haptics.selectionAsync().catch(() => {});
      router.push(
        `/(modals)/workout-debrief-chat?workoutId=${encodeURIComponent(workoutId)}`,
      );
    },
    [router],
  );

  // Pick the most recently logged exercise for the overload card. We fall
  // back to the first row when dates are missing; if the list is empty, the
  // card is hidden entirely to keep the empty-state screen clean.
  const featuredExercise = useMemo(() => {
    if (!workouts || workouts.length === 0) return null;
    const sorted = [...workouts].sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      return bd - ad;
    });
    return sorted[0].exercise;
  }, [workouts]);

  const openProgressionPlan = useCallback(() => {
    if (!featuredExercise) return;
    // Gated on EXPO_PUBLIC_PROGRESSION_PLAN — no-op when flag is off so the
    // analytics card can still render (in "view only" mode) without opening
    // the modal. Issue #475.
    if (!isProgressionPlanEnabled()) return;
    Haptics.selectionAsync().catch(() => {});
    router.push(
      `/(modals)/progression-plan?exercise=${encodeURIComponent(featuredExercise)}`,
    );
  }, [featuredExercise, router]);

  // Populate the form-quality map whenever the workout list changes.
  // Unique exercises only — the same name is re-used across sets.
  useEffect(() => {
    if (!workouts || workouts.length === 0) return;
    const uniqueNames = Array.from(
      new Set(workouts.map((w) => w.exercise).filter(Boolean)),
    );
    let cancelled = false;
    (async () => {
      const pairs = await Promise.all(
        uniqueNames.map(async (name) => {
          try {
            const score = await getMostRecentAvgFqi(name);
            return [name, score] as const;
          } catch {
            return [name, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setFormQualityByExercise((prev) => {
        const next = { ...prev };
        for (const [name, score] of pairs) next[name] = score;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [workouts]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshWorkouts();
      setLastSynced(new Date());
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshWorkouts]);

  const lastUpdatedLabel = lastSynced
    ? `Last updated ${lastSynced.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : null;

  const handleAddPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logWithTs('Navigating to workout-session from workouts tab');
    router.push('/(modals)/workout-session');
  };

  // Legacy add-workout modal - kept for compatibility, to be removed later
  const handleQuickAddPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(modals)/add-workout');
  };

  const handleDeleteWorkout = useCallback(
    async (id: string, title: string) => {
      try {
        // Close swipeable before delete
        swipeableRefs.current.get(id)?.close();
        await deleteWorkout(id);
        showToast(`Removed ${title}`, { type: 'info' });
        // Clean up ref
        swipeableRefs.current.delete(id);
      } catch (error) {
        errorWithTs('[Workouts] delete failed', error);
        const isNetworkError =
          error instanceof Error &&
          (error.message.toLowerCase().includes('network') ||
            error.message.toLowerCase().includes('fetch') ||
            error.message.toLowerCase().includes('offline'));
        showToast(
          isNetworkError
            ? "Couldn't delete — check your connection"
            : "Couldn't delete workout — try again",
          { type: 'error' }
        );
      }
    },
    [deleteWorkout, showToast]
  );

  const confirmDeleteWorkout = useCallback(
    (id: string, title: string) => {
      Alert.alert('Delete workout?', `This will permanently remove "${title}".`, [
        { text: 'Cancel', style: 'cancel', onPress: () => swipeableRefs.current.get(id)?.close() },
        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteWorkout(id, title) },
      ]);
    },
    [handleDeleteWorkout]
  );

  const renderRightActions = (id: string, title: string) => (
    <TouchableOpacity
      accessibilityLabel={`Delete ${title}`}
      accessibilityHint="Removes this workout from your history"
      accessibilityRole="button"
      onPress={() => confirmDeleteWorkout(id, title)}
      style={styles.swipeDelete}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" accessible={false} />
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </TouchableOpacity>
  );

  const handleShareWorkout = useCallback(
    async (workout: Workout) => {
      try {
        const message = buildWorkoutShareMessage(workout, getWeightLabel());
        await Share.share({ message });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch (error) {
        warnWithTs('[Workouts] share failed', error);
        showToast('Unable to share this workout right now.', { type: 'error' });
      }
    },
    [getWeightLabel, showToast]
  );

  // --- Session timeline + export (#476) -----------------------------------
  const handleOpenTimeline = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.push('/(modals)/session-timeline');
  }, [router]);

  const exportLatestSession = useCallback(
    async (format: 'json' | 'csv') => {
      try {
        const db = (await import('@/lib/services/database/local-db')).localDB.db;
        if (!db) {
          showToast('Storage unavailable — try again shortly.', { type: 'error' });
          return;
        }
        const rows = await db.getAllAsync<{ id: string }>(
          `SELECT id FROM workout_sessions
            WHERE deleted = 0 AND ended_at IS NOT NULL
            ORDER BY started_at DESC LIMIT 1`,
        );
        const sessionId = rows[0]?.id;
        if (!sessionId) {
          showToast('No completed sessions to export yet.', { type: 'info' });
          return;
        }
        const res = await exportSession(sessionId, format);
        await Share.share({ url: res.path, title: `Session export (${format.toUpperCase()})` });
        showToast(`Exported ${format.toUpperCase()}`, { type: 'success' });
      } catch (err) {
        errorWithTs('[Workouts] export failed', err);
        showToast('Export failed — please try again.', { type: 'error' });
      }
    },
    [showToast]
  );

  const handleOpenExportMenu = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    Alert.alert(
      'Export latest session',
      'Choose a format to share with your coach.',
      [
        { text: 'JSON', onPress: () => exportLatestSession('json') },
        { text: 'CSV', onPress: () => exportLatestSession('csv') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [exportLatestSession]);

  const renderIntelHeader = () => (
    <View style={intelHeaderStyles.row}>
      <TouchableOpacity
        style={intelHeaderStyles.pill}
        onPress={handleOpenTimeline}
        accessibilityLabel="Open session timeline"
        accessibilityRole="button"
      >
        <Ionicons name="calendar-outline" size={14} color="#4C8CFF" />
        <Text style={intelHeaderStyles.pillText}>Timeline</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={intelHeaderStyles.pill}
        onPress={handleOpenExportMenu}
        accessibilityLabel="Export latest session"
        accessibilityRole="button"
      >
        <Ionicons name="download-outline" size={14} color="#4C8CFF" />
        <Text style={intelHeaderStyles.pillText}>Export</Text>
      </TouchableOpacity>
    </View>
  );

  const renderItem = (info: { item: Workout }) => {
    const { item } = info;
    return (
      <Swipeable 
        ref={(ref) => {
          if (ref) {
            swipeableRefs.current.set(item.id, ref);
          }
        }}
        renderRightActions={() => renderRightActions(item.id, item.exercise)}
      >
        <View style={styles.card}>
          <TouchableOpacity 
            activeOpacity={0.9}
            accessibilityLabel={`${item.exercise} workout`}
            accessibilityHint="Swipe left to reveal delete actions"
            onPress={() => {
              Haptics.selectionAsync();
              // Navigate to workout detail
            }}
          >
          <LinearGradient
            colors={['#0F2339', '#081526']}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.exercise}
              </Text>
              <View style={styles.cardDateContainer}>
                <Ionicons name="time-outline" size={14} color="#8E8E93" />
                <Text style={styles.cardDate}>
                  {new Date(item.date).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </View>

            <FormQualityBadgeRow
              exerciseName={item.exercise}
              score={formQualityByExercise[item.exercise]}
              style={workoutCardStyles.badgeRow}
            />


            <View style={styles.cardDetails}>
              <View style={styles.detailItem}>
                <Text style={styles.detailValue}>{item.sets || '0'}</Text>
                <Text style={styles.detailLabel}>Sets</Text>
              </View>
              
              {item.reps && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{item.reps}</Text>
                  <Text style={styles.detailLabel}>Reps</Text>
                </View>
              )}
              
              {item.weight && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{item.weight}</Text>
                  <Text style={styles.detailLabel}>{getWeightLabel()}</Text>
                </View>
              )}
              
              {item.duration && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{item.duration}</Text>
                  <Text style={styles.detailLabel}>min</Text>
                </View>
              )}
            </View>
            
            <View style={styles.cardFooter}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const lines = [
                    `Exercise: ${item.exercise}`,
                    item.date ? `Date: ${new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : null,
                    `Sets: ${item.sets || 0}`,
                    typeof item.reps === 'number' && item.reps > 0 ? `Reps: ${item.reps}` : null,
                    typeof item.weight === 'number' && item.weight > 0 ? `Weight: ${item.weight} lbs` : null,
                    typeof item.duration === 'number' && item.duration > 0 ? `Duration: ${item.duration} min` : null,
                  ].filter(Boolean) as string[];
                  Alert.alert(item.exercise, lines.join('\n'));
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="eye-outline" size={16} color="#007AFF" />
                <Text style={styles.actionText}>View</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity
                style={[styles.actionButton, styles.shareActionButton]}
                onPress={() => handleShareWorkout(item)}
                activeOpacity={0.85}
              >
                <Ionicons name="share-outline" size={18} color="#4C8CFF" />
                <View style={styles.shareTextWrapper}>
                  <Text style={[styles.actionText, styles.shareActionTitle]}>Share</Text>
                  <Text style={styles.actionSubtext}>Send stats</Text>
                </View>
              </TouchableOpacity>
              <View style={styles.divider} />
              <DeleteAction
                id={item.id}
                onDelete={async (workoutId) => handleDeleteWorkout(workoutId, item.exercise)}
                variant="icon"
                confirmTitle="Delete workout?"
                confirmMessage={`This will permanently remove \"${item.exercise}\".`}
                style={styles.deleteAction}
              />
            </View>
            {coachRecallEnabled ? (
              <View style={workoutCardStyles.askCoachRow} testID={`ask-coach-row-${item.id}`}>
                <AskCoachCTA
                  exerciseName={item.exercise}
                  repCount={typeof item.reps === 'number' ? item.reps : 0}
                  averageFqi={formQualityByExercise[item.exercise] ?? null}
                  onPress={() => handleAskCoachAboutWorkout(item.id)}
                  label="Ask Gemma about this workout"
                  testID={`ask-coach-cta-${item.id}`}
                />
              </View>
            ) : null}
          </LinearGradient>
          </TouchableOpacity>
        </View>
      </Swipeable>
    );
  };

  // Skeleton placeholders on cold-load keep the tab usable on slow networks
  // (#562/A1). Render 3 shimmer cards that mirror the real-card dimensions so
  // users see structure instead of a blank spinner. When the fetch completes,
  // the FlatList below takes over; when the list arrives empty, the empty
  // state with illustration + CTA takes over.
  if (loading && !workouts.length) {
    return (
      <View style={styles.container} testID="workouts-skeleton-container">
        <View style={styles.list}>
          <WorkoutCardSkeleton testID="workout-card-skeleton-0" />
          <WorkoutCardSkeleton testID="workout-card-skeleton-1" />
          <WorkoutCardSkeleton testID="workout-card-skeleton-2" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {workouts.length === 0 ? (
        <ScrollView 
          contentContainerStyle={styles.emptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#007AFF"
              colors={['#007AFF']}
            />
          }
        >
          {renderIntelHeader()}
          {lastUpdatedLabel ? (
            <Text style={{ color: '#8E8E93', fontSize: 12, marginBottom: 16, textAlign: 'center' }}>{lastUpdatedLabel}</Text>
          ) : null}
          <View style={styles.emptyIllustration}>
            <Ionicons name="barbell-outline" size={80} color="#E5E5EA" />
          </View>
          <Text style={styles.emptyTitle}>No Workouts Yet</Text>
          <Text style={styles.emptyDescription}>
            Track your first workout to see your progress over time
          </Text>
          <TouchableOpacity 
            style={styles.addFirstButton}
            onPress={handleAddPress}
          >
            <Text style={styles.addFirstButtonText}>Start Session</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addFirstButton, { marginTop: 12, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4C8CFF' }]}
            onPress={() => router.push('/(modals)/templates')}
          >
            <Text style={[styles.addFirstButtonText, { color: '#4C8CFF' }]}>Templates</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addFirstButton, { marginTop: 8, backgroundColor: 'transparent', borderWidth: 0 }]}
            onPress={handleQuickAddPress}
          >
            <Text style={[styles.addFirstButtonText, { color: '#8E8E93', fontSize: 14 }]}>Quick Add (legacy)</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={workouts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {renderIntelHeader()}
              {lastUpdatedLabel ? (
                <Text style={{ color: '#8E8E93', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{lastUpdatedLabel}</Text>
              ) : null}
              {featuredExercise && isOverloadCardEnabled() ? (
                <OverloadAnalyticsCard
                  userId={user?.id ?? 'local-user'}
                  exercise={featuredExercise}
                  onPressPlan={openProgressionPlan}
                />
              ) : null}
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#007AFF"
              colors={['#007AFF']}
            />
          }
        />
      )}
      <TouchableOpacity
        style={styles.addButton}
        onPress={handleAddPress}
        activeOpacity={0.9}
        accessibilityLabel="Add workout"
        accessibilityRole="button"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// --- Local styles for the per-card form quality badge (#494) ----------------
const workoutCardStyles = StyleSheet.create({
  badgeRow: {
    marginTop: 6,
    marginBottom: 2,
  },
  // Wave-25: pulled-in padding on the embedded AskCoachCTA so it does
  // not break out of the card gradient. The CTA wraps itself in its
  // own padding; this container just tightens the vertical margin.
  askCoachRow: {
    marginTop: 4,
    marginBottom: -4,
  },
});

// --- Local styles for the form-intel header pills (#476) ---------------------
const intelHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#4C8CFF15',
    borderWidth: 1,
    borderColor: '#4C8CFF30',
  },
  pillText: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    color: '#4C8CFF',
  },
});

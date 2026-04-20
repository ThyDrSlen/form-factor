/**
 * Practice Mode modal
 *
 * Dry-run tracking surface introduced by issue #479. Lets new users pick
 * an exercise, watch the same overlays they'd see in a live session, and
 * step away with zero persistence — no session written to SQLite, no
 * Supabase row, no HealthKit entry, no watch-bridge event.
 *
 * This screen is intentionally lightweight — the heavy camera / ARKit
 * pipeline lives in `app/(tabs)/scan-arkit.tsx`. The practice modal is a
 * staging surface so users can set expectations ("this won't be saved")
 * before tapping "Start practice" which routes them to the scan tab with
 * a `practice=true` flag the tab honors to short-circuit persistence.
 */

import React, { useCallback, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import PracticeSessionBadge from '@/components/form-tracking/PracticeSessionBadge';
import { usePracticeSessionHook } from '@/hooks/use-practice-session';
import { getWorkoutByMode, getWorkoutIds, type DetectionMode } from '@/lib/workouts';

const EXERCISE_SUBSET: DetectionMode[] = ['pullup', 'pushup', 'squat', 'deadlift'];

export default function PracticeModeModal(): React.ReactElement {
  const router = useRouter();
  const practice = usePracticeSessionHook({ autoResetOnUnmount: true });

  const exercises = useMemo<DetectionMode[]>(() => {
    const all = getWorkoutIds();
    // Keep the priority subset at the top; include the rest so the surface
    // degrades gracefully as new workout definitions are added.
    const rest = all.filter((m) => !EXERCISE_SUBSET.includes(m));
    return [...EXERCISE_SUBSET.filter((m) => all.includes(m)), ...rest];
  }, []);

  const handleClose = useCallback(() => {
    practice.reset();
    router.back();
  }, [practice, router]);

  const handleSelect = useCallback(
    (key: DetectionMode) => {
      practice.start(key);
      // Route to the scan tab; the scan-arkit integration reads
      // `practice=1` and the active exercise from the practice store.
      const query = new URLSearchParams({ practice: '1', exercise: String(key) }).toString();
      router.replace(`/(tabs)/scan-arkit?${query}`);
    },
    [practice, router]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close practice mode"
          style={styles.closeButton}
        >
          <Ionicons name="close" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Practice mode</Text>
          <PracticeSessionBadge visible label="PRACTICE" />
        </View>
        <View style={styles.closeButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What is practice mode?</Text>
          <Text style={styles.cardBody}>
            A safe sandbox to get comfortable with form tracking. You&apos;ll see the
            same overlays — joint skeleton, rep counter, coach cues — but nothing is
            saved to your workouts, HealthKit, or Apple Watch.
          </Text>
          <View style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.bulletText}>Zero persistence (no workout history entries)</Text>
          </View>
          <View style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.bulletText}>Full FQI + fault overlay, same as live</Text>
          </View>
          <View style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.bulletText}>Exit anytime — no confirmation prompts</Text>
          </View>
        </View>

        <Text style={styles.sectionHeader}>Pick an exercise</Text>

        {exercises.map((mode) => {
          const def = getWorkoutByMode(mode);
          return (
            <TouchableOpacity
              key={mode}
              style={styles.exerciseRow}
              onPress={() => handleSelect(mode)}
              accessibilityRole="button"
              accessibilityLabel={`Start practice for ${def.displayName}`}
            >
              <View style={styles.exerciseIcon}>
                <Ionicons
                  name={(def.ui?.iconName ?? 'barbell-outline') as keyof typeof Ionicons.glyphMap}
                  size={20}
                  color="#F5F7FF"
                />
              </View>
              <View style={styles.exerciseTextWrap}>
                <Text style={styles.exerciseName}>{def.displayName}</Text>
                <Text style={styles.exerciseHint}>Dry-run — nothing saved</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#8693A8" />
            </TouchableOpacity>
          );
        })}

        <Text style={styles.footerNote}>
          You can end practice anytime by tapping the close button.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitleWrap: {
    alignItems: 'center',
    gap: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: 'rgba(250, 140, 22, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250, 176, 92, 0.22)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAB05C',
    marginBottom: 4,
    fontFamily: 'Lexend_700Bold',
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(245, 247, 255, 0.85)',
    marginBottom: 4,
    fontFamily: 'Lexend_400Regular',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulletText: {
    fontSize: 12,
    color: 'rgba(245, 247, 255, 0.78)',
    fontFamily: 'Lexend_400Regular',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8693A8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    fontFamily: 'Lexend_500Medium',
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10,
    gap: 12,
  },
  exerciseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  exerciseTextWrap: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F5F7FF',
    fontFamily: 'Lexend_500Medium',
  },
  exerciseHint: {
    fontSize: 11,
    color: '#8693A8',
    marginTop: 2,
    fontFamily: 'Lexend_400Regular',
  },
  footerNote: {
    fontSize: 11,
    color: '#5D6B83',
    textAlign: 'center',
    marginTop: 16,
    fontFamily: 'Lexend_400Regular',
  },
});

/**
 * GenerateSessionScreen
 *
 * Modal screen that opens from the Templates / Template Builder screens.
 * User types a natural-language description (e.g. "pushups + pullups, 30 min, home"),
 * taps Generate, and on success the resulting template is persisted locally and
 * the builder is reopened with the generated template pre-loaded.
 *
 * If the AI call fails, the user sees the error + can fall back to an offline
 * template via the "Use offline suggestion" action.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { tabColors } from '@/styles/tabs/_tab-theme';
import { sessionStyles } from '@/styles/workout-session.styles';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { CrashBoundary } from '@/components/CrashBoundary';
import { useSessionGenerator } from '@/hooks/use-session-generator';
import {
  getSessionFallback,
  withFallback,
} from '@/lib/services/session-generator-fallback';
import {
  isGemmaSessionGenEnabled,
  FLAG_DISABLED_ERROR_CODE,
} from '@/lib/services/gemma-session-gen-flag';
import { localDB } from '@/lib/services/database/local-db';
import { genericLocalUpsert } from '@/lib/services/database/generic-sync';
import { isWarmupCoachFlowEnabled } from '@/lib/services/coach-warmup-provider';
import { createError, logError } from '@/lib/services/ErrorHandler';
import type { Exercise, GoalProfile } from '@/lib/types/workout-session';
import type { HydratedTemplate } from '@/lib/services/session-generator';

const GOAL_OPTIONS: { value: GoalProfile; label: string }[] = [
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'strength', label: 'Strength' },
  { value: 'power', label: 'Power' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'mixed', label: 'Mixed' },
];

const DURATION_OPTIONS = [15, 30, 45, 60];

async function resolveExerciseSlugsToIds(slugs: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const db = localDB.db;
  if (!db) return map;

  const rows = await db.getAllAsync<Exercise>('SELECT * FROM exercises');
  for (const slug of slugs) {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = rows.find((r) => r.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalized))
      ?? rows.find((r) => normalized.includes(r.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
    if (match) map.set(slug, match.id);
  }
  return map;
}

async function persistHydrated(hydrated: HydratedTemplate): Promise<void> {
  const slugs = hydrated.exercises.map((e) => e.exercise_slug);
  const resolved = await resolveExerciseSlugsToIds(slugs);
  const now = new Date().toISOString();

  await genericLocalUpsert('workout_templates', 'id', {
    id: hydrated.template.id,
    name: hydrated.template.name,
    description: hydrated.template.description,
    goal_profile: hydrated.template.goal_profile,
    is_public: 0,
    share_slug: null,
    synced: 0,
    deleted: 0,
    updated_at: now,
    created_at: now,
  }, 0);

  for (let i = 0; i < hydrated.exercises.length; i++) {
    const ex = hydrated.exercises[i];
    const exerciseId = resolved.get(ex.exercise_slug);
    if (!exerciseId) continue; // skip unresolved slugs

    await genericLocalUpsert('workout_template_exercises', 'id', {
      id: ex.id,
      template_id: hydrated.template.id,
      exercise_id: exerciseId,
      sort_order: i,
      notes: ex.notes,
      default_rest_seconds: ex.default_rest_seconds,
      default_tempo: null,
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
}

export default function GenerateSessionScreen() {
  return (
    <CrashBoundary
      fallbackTitle="Generator crashed"
      fallbackMessage="The session generator hit an unexpected error. Close this modal and try again, or pick from the Templates tab."
    >
      <GenerateSessionScreenBody />
    </CrashBoundary>
  );
}

function GenerateSessionScreenBody() {
  const router = useRouter();
  const { user } = useAuth();
  const { show: showToast } = useToast();
  const [intent, setIntent] = useState('');
  const [goalProfile, setGoalProfile] = useState<GoalProfile>('hypertrophy');
  const [durationMin, setDurationMin] = useState<number>(30);

  const userId = user?.id ?? 'local-user';
  const aiEnabled = isGemmaSessionGenEnabled();

  const { loading, error, result, generate, reset } = useSessionGenerator({
    runtime: { userId, maxRetries: 1 },
  });

  // Capture the last successfully persisted template id so the warmup CTA
  // survives after the user navigates to the builder and back. Separate
  // from `result` because the generator hook may reset on subsequent calls.
  const [lastTemplateId, setLastTemplateId] = useState<string | null>(null);
  const warmupCoachEnabled = isWarmupCoachFlowEnabled();

  // Resolve exercise slugs from the local DB; if that throws (missing table
  // during migration, SQLite closed on web, etc.) we return an empty list so
  // the AI can still attempt a generation using its built-in catalogue.
  const availableSlugsPromise = useMemo(async () => {
    try {
      const db = localDB.db;
      if (!db) return [] as string[];
      const rows = await db.getAllAsync<Exercise>('SELECT name FROM exercises LIMIT 64');
      return rows.map((r) => r.name.toLowerCase().replace(/[^a-z0-9]/g, '_'));
    } catch (err) {
      logError(
        createError('storage', 'EXERCISE_SLUGS_QUERY_FAILED',
          err instanceof Error ? err.message : 'Failed to read exercise slugs.',
          { details: err, severity: 'warning' }),
        { feature: 'workouts', location: 'generate-session.availableSlugsPromise' },
      );
      return [] as string[];
    }
  }, []);

  const handleOfflineFallback = useCallback(async () => {
    const hydrated = await withFallback(
      async () => getSessionFallback({ goalProfile, durationMin }, { userId }),
      () => getSessionFallback({}, { userId }),
    );
    await persistHydrated(hydrated);
    setLastTemplateId(hydrated.template.id);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    router.replace(`/(modals)/template-builder?templateId=${hydrated.template.id}` as never);
  }, [goalProfile, durationMin, userId, router]);

  const handleGenerate = useCallback(async () => {
    const trimmed = intent.trim();
    if (trimmed.length === 0) {
      showToast('Tell the AI what you want to train.', { type: 'info' });
      return;
    }
    // Flag off: skip the dispatch entirely and use the offline library so the
    // user still walks out with a template instead of hitting a disabled error.
    if (!aiEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await handleOfflineFallback();
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const availableExerciseSlugs = await availableSlugsPromise;
    const hydrated = await generate({
      intent: trimmed,
      goalProfile,
      durationMin,
      availableExerciseSlugs,
    });
    if (hydrated) {
      await persistHydrated(hydrated);
      setLastTemplateId(hydrated.template.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(modals)/template-builder?templateId=${hydrated.template.id}` as never);
    }
  }, [
    intent,
    aiEnabled,
    goalProfile,
    durationMin,
    availableSlugsPromise,
    generate,
    handleOfflineFallback,
    router,
    showToast,
  ]);

  const handleWarmupCoach = useCallback(() => {
    if (!lastTemplateId) return;
    router.push(
      `/(modals)/session-warmup-coach?sessionId=${encodeURIComponent(lastTemplateId)}` as never,
    );
  }, [lastTemplateId, router]);

  const handleClose = useCallback(() => {
    reset();
    router.back();
  }, [reset, router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Generate Session</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Describe your session</Text>
        <TextInput
          style={[styles.input, { minHeight: 100 }]}
          value={intent}
          onChangeText={setIntent}
          placeholder="e.g. pushups + pullups, 30 min, home, no equipment"
          placeholderTextColor={tabColors.textSecondary}
          multiline
          accessibilityLabel="Session description"
          editable={!loading}
        />

        <Text style={styles.label}>Goal profile</Text>
        <View style={sessionStyles.segmentedControl}>
          {GOAL_OPTIONS.map((g) => (
            <TouchableOpacity
              key={g.value}
              style={[
                sessionStyles.segmentButton,
                goalProfile === g.value && sessionStyles.segmentButtonActive,
              ]}
              onPress={() => setGoalProfile(g.value)}
              disabled={loading}
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

        <Text style={styles.label}>Duration</Text>
        <View style={styles.durationRow}>
          {DURATION_OPTIONS.map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.durationChip, durationMin === d && styles.durationChipActive]}
              onPress={() => setDurationMin(d)}
              disabled={loading}
            >
              <Text
                style={[
                  styles.durationChipText,
                  durationMin === d && styles.durationChipTextActive,
                ]}
              >
                {d} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
          onPress={handleGenerate}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={aiEnabled ? 'Generate session with AI' : 'Generate from offline library'}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {aiEnabled ? 'Generate' : 'Use offline library'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {!aiEnabled && !loading && (
          <View style={styles.infoCard} accessibilityRole="alert">
            <Ionicons name="information-circle-outline" size={18} color={tabColors.accent} />
            <Text style={styles.infoText}>
              AI generation is disabled on this build. Tapping Generate will pull a handcrafted template from the offline library.
            </Text>
          </View>
        )}

        {error && !loading && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={18} color={tabColors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorText}>
                {(error as { code?: string }).code === FLAG_DISABLED_ERROR_CODE
                  ? 'AI generation is disabled on this build. Use the offline library below.'
                  : ((error as { message?: string }).message ?? 'Generation failed.')}
              </Text>
              <TouchableOpacity onPress={handleOfflineFallback}>
                <Text style={styles.offlineLink}>Use offline suggestion</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {result && !loading && (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>{result.raw.name}</Text>
            {result.raw.description ? (
              <Text style={styles.previewDesc}>{result.raw.description}</Text>
            ) : null}
            <Text style={styles.previewMeta}>
              {result.raw.exercises.length} exercises · {result.raw.goal_profile}
            </Text>
          </View>
        )}

        {warmupCoachEnabled && lastTemplateId && !loading && (
          <TouchableOpacity
            onPress={handleWarmupCoach}
            style={styles.warmupCta}
            accessibilityRole="button"
            accessibilityLabel="Warm up with coach for this session"
            testID="generate-session-warmup-cta"
          >
            <Ionicons name="flame-outline" size={18} color={tabColors.accent} />
            <Text style={styles.warmupCtaText}>Warm up with coach</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    textAlignVertical: 'top',
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: tabColors.border,
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
  },
  durationChipActive: {
    backgroundColor: tabColors.accent,
    borderColor: tabColors.accent,
  },
  durationChipText: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textSecondary,
  },
  durationChipTextActive: {
    color: '#fff',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: tabColors.accent,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(10, 132, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(10, 132, 255, 0.2)',
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    lineHeight: 16,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textPrimary,
  },
  offlineLink: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.accent,
    marginTop: 6,
  },
  previewCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
  },
  previewTitle: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  previewDesc: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 4,
  },
  previewMeta: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.accent,
    marginTop: 8,
  },
  warmupCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tabColors.accent,
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
  },
  warmupCtaText: {
    fontSize: 14,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.accent,
  },
});

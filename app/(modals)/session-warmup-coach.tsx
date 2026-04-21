/**
 * SessionWarmupCoachScreen
 *
 * Pre-session warmup coach modal. Opens from `generate-session` when
 * `EXPO_PUBLIC_WARMUP_COACH` is on. Takes a `sessionId` (the locally
 * persisted `workout_templates.id` produced by the session generator)
 * and builds a warmup plan via `usePreSessionCoach`.
 *
 * Intentionally lightweight: no local DB caching of the plan, no
 * analytics. This is an exploratory surface — we want the user to be
 * able to re-roll freely before committing.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDB } from '@/lib/services/database/local-db';
import { usePreSessionCoach } from '@/hooks/use-pre-session-coach';
import type { SessionTemplateLike, WarmupMovement } from '@/lib/services/coach-warmup-provider';
import { tabColors } from '@/styles/tabs/_tab-theme';

interface TemplateRow {
  id: string;
  name: string | null;
}

interface TemplateExerciseRow {
  exercise_name: string | null;
  sort_order: number | null;
}

interface ResolvedTemplate {
  sessionId: string;
  name: string;
  exerciseNames: string[];
}

async function loadTemplate(sessionId: string): Promise<ResolvedTemplate | null> {
  const db = localDB.db;
  if (!db) return null;

  const templateRows = await db.getAllAsync<TemplateRow>(
    'SELECT id, name FROM workout_templates WHERE id = ? LIMIT 1',
    sessionId,
  );
  if (templateRows.length === 0) return null;
  const template = templateRows[0];

  const exerciseRows = await db.getAllAsync<TemplateExerciseRow>(
    `SELECT e.name AS exercise_name, wte.sort_order AS sort_order
     FROM workout_template_exercises wte
     JOIN exercises e ON e.id = wte.exercise_id
     WHERE wte.template_id = ?
     ORDER BY wte.sort_order ASC`,
    sessionId,
  );

  const exerciseNames = exerciseRows
    .map((r) => r.exercise_name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

  return {
    sessionId,
    name: template.name ?? 'Session',
    exerciseNames,
  };
}

function formatMovementMeta(mv: WarmupMovement): string {
  const parts: string[] = [];
  if (typeof mv.reps === 'number') parts.push(`${mv.reps} reps`);
  if (typeof mv.duration_seconds === 'number') parts.push(`${mv.duration_seconds}s`);
  parts.push(mv.focus);
  parts.push(mv.intensity);
  return parts.join(' · ');
}

export default function SessionWarmupCoachScreen(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = useMemo(() => {
    const raw = params.sessionId;
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw ?? null;
  }, [params.sessionId]);

  const [template, setTemplate] = useState<ResolvedTemplate | null>(null);
  const [templateError, setTemplateError] = useState<Error | null>(null);
  const [templateLoading, setTemplateLoading] = useState<boolean>(!!sessionId);

  const { warmup, loading, error, generateWarmup, enabled } = usePreSessionCoach();

  // Resolve the template from local SQLite on mount.
  useEffect(() => {
    if (!sessionId) {
      setTemplate(null);
      setTemplateLoading(false);
      return;
    }
    let cancelled = false;
    setTemplateLoading(true);
    setTemplateError(null);
    void (async () => {
      try {
        const resolved = await loadTemplate(sessionId);
        if (cancelled) return;
        setTemplate(resolved);
        setTemplateLoading(false);
      } catch (err) {
        if (cancelled) return;
        setTemplateError(err instanceof Error ? err : new Error('Template load failed'));
        setTemplateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleGenerate = useCallback(async () => {
    if (!template) return;
    const input: SessionTemplateLike = {
      exerciseSlugs: template.exerciseNames,
    };
    await generateWarmup(input);
  }, [template, generateWarmup]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Auto-kick off the first generation when the template is ready and
  // nothing is on screen yet — saves the user one tap and matches the
  // "warm up with coach" intent.
  useEffect(() => {
    if (!enabled) return;
    if (!template) return;
    if (warmup || loading || error) return;
    void handleGenerate();
  }, [enabled, template, warmup, loading, error, handleGenerate]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="session-warmup-coach">
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close warmup coach"
          testID="session-warmup-close"
        >
          <Ionicons name="close" size={22} color={tabColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Warm up with coach</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!enabled ? (
          <View style={styles.banner} testID="session-warmup-flag-off">
            <Text style={styles.bannerText}>
              Warmup coach is currently disabled. Ask your admin to enable the
              EXPO_PUBLIC_WARMUP_COACH feature flag.
            </Text>
          </View>
        ) : !sessionId ? (
          <View style={styles.banner} testID="session-warmup-missing-session">
            <Text style={styles.bannerText}>
              No session selected. Reopen the generator and tap “Warm up with
              coach” after choosing a template.
            </Text>
          </View>
        ) : templateLoading ? (
          <View style={styles.centerBlock} testID="session-warmup-loading-template">
            <ActivityIndicator color={tabColors.accent} />
            <Text style={styles.loadingText}>Loading session…</Text>
          </View>
        ) : templateError || !template ? (
          <View style={styles.centerBlock} testID="session-warmup-template-error">
            <Text style={styles.errorText}>
              {templateError?.message ?? 'Could not find that session.'}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Back to generate session"
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.label}>Session</Text>
            <Text style={styles.sessionName} testID="session-warmup-session-name">
              {template.name}
            </Text>
            {template.exerciseNames.length > 0 && (
              <Text style={styles.sessionMeta}>
                {template.exerciseNames.join(' · ')}
              </Text>
            )}

            {loading ? (
              <View style={styles.centerBlock} testID="session-warmup-generating">
                <ActivityIndicator color={tabColors.accent} />
                <Text style={styles.loadingText}>
                  Coach is building your warmup…
                </Text>
                {/* Skeleton rows — 3 placeholder lines so the layout doesn't pop */}
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.skeletonRow} />
                ))}
              </View>
            ) : error ? (
              <View style={styles.errorCard} testID="session-warmup-error">
                <Text style={styles.errorText}>
                  {error.message || 'Warmup generation failed.'}
                </Text>
                <TouchableOpacity
                  onPress={handleGenerate}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Retry warmup generation"
                  testID="session-warmup-retry"
                >
                  <Text style={styles.primaryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : warmup ? (
              <View style={styles.warmupBlock} testID="session-warmup-plan">
                <Text style={styles.warmupName}>{warmup.name}</Text>
                <Text style={styles.warmupMeta}>{warmup.duration_min} min warmup</Text>
                {warmup.movements.map((mv, idx) => (
                  <View
                    key={`${mv.name}-${idx}`}
                    style={styles.movementRow}
                    testID={`session-warmup-movement-${idx}`}
                  >
                    <View style={styles.movementNumber}>
                      <Text style={styles.movementNumberText}>{idx + 1}</Text>
                    </View>
                    <View style={styles.movementBody}>
                      <Text style={styles.movementName}>{mv.name}</Text>
                      <Text style={styles.movementMeta}>{formatMovementMeta(mv)}</Text>
                      {mv.notes && <Text style={styles.movementNotes}>{mv.notes}</Text>}
                    </View>
                  </View>
                ))}

                <TouchableOpacity
                  onPress={handleGenerate}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Regenerate warmup"
                  testID="session-warmup-regenerate"
                >
                  <Text style={styles.secondaryButtonText}>Try another warmup</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.centerBlock} testID="session-warmup-idle">
                <Text style={styles.loadingText}>Tap “Generate” to build a warmup.</Text>
                <TouchableOpacity
                  onPress={handleGenerate}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Generate warmup"
                  testID="session-warmup-generate"
                >
                  <Text style={styles.primaryButtonText}>Generate</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
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
  content: {
    padding: 16,
    gap: 16,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textSecondary,
  },
  sessionName: {
    fontSize: 17,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  sessionMeta: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 2,
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  skeletonRow: {
    height: 28,
    width: '90%',
    backgroundColor: 'rgba(15, 35, 57, 0.5)',
    borderRadius: 8,
    marginTop: 4,
  },
  banner: {
    backgroundColor: 'rgba(255, 210, 85, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 210, 85, 0.35)',
    borderRadius: 12,
    padding: 14,
  },
  bannerText: {
    color: tabColors.textPrimary,
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    lineHeight: 19,
  },
  errorCard: {
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  errorText: {
    color: tabColors.textPrimary,
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
  },
  warmupBlock: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
  },
  warmupName: {
    color: tabColors.textPrimary,
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
  },
  warmupMeta: {
    color: tabColors.accent,
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    marginBottom: 6,
  },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  movementNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.22)',
  },
  movementNumberText: {
    color: tabColors.accent,
    fontSize: 12,
    fontFamily: 'Lexend_700Bold',
  },
  movementBody: {
    flex: 1,
  },
  movementName: {
    color: tabColors.textPrimary,
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
  },
  movementMeta: {
    color: tabColors.textSecondary,
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    marginTop: 2,
  },
  movementNotes: {
    color: tabColors.textSecondary,
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    marginTop: 4,
    fontStyle: 'italic',
  },
  primaryButton: {
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: tabColors.accent,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Lexend_700Bold',
  },
  secondaryButton: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: tabColors.accent,
  },
  secondaryButtonText: {
    color: tabColors.accent,
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
  },
});

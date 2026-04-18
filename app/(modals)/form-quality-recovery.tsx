import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormQualityRecoveryCard } from '@/components/form-tracking/FormQualityRecoveryCard';
import { useFormQualityRecovery } from '@/hooks/use-form-quality-recovery';
import type { Drill, DrillPrescription } from '@/lib/services/form-quality-recovery';
import { tabColors } from '@/styles/tabs/_tab-theme';

function pickTopExerciseId(prescription: DrillPrescription, fallback: string): string {
  const first = prescription.targetFaults[0];
  if (!first) return fallback;
  return fallback;
}

export default function FormQualityRecoveryScreen(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const rawSessionId = params.sessionId;
  const sessionId = useMemo(() => {
    if (Array.isArray(rawSessionId)) return rawSessionId[0] ?? null;
    return rawSessionId ?? null;
  }, [rawSessionId]);

  const {
    isLoading,
    error,
    prescriptions,
    summary,
    refresh,
    requestExplanation,
    explanations,
  } = useFormQualityRecovery(sessionId);
  const [doneDrills, setDoneDrills] = useState<Set<string>>(new Set());

  const topExerciseId = summary?.aggregates[0]?.exerciseId ?? 'workout';

  const handleExplain = useCallback(
    (drill: Drill) => {
      const prescription = prescriptions.find((p) => p.drill.id === drill.id);
      const faults = prescription?.targetFaults.map((tf) => ({
        code: tf.faultCode,
        displayName: tf.faultDisplayName,
        count: tf.count,
        severity: tf.maxSeverity,
      })) ?? [];
      const exerciseId = prescription
        ? pickTopExerciseId(prescription, topExerciseId)
        : topExerciseId;
      void requestExplanation(drill.id, {
        drillTitle: drill.title,
        drillCategory: drill.category,
        drillWhy: drill.why,
        exerciseId,
        faults,
      });
    },
    [prescriptions, requestExplanation, topExerciseId]
  );

  const handleMarkDone = useCallback((drillId: string) => {
    setDoneDrills((prev) => {
      const next = new Set(prev);
      next.add(drillId);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: DrillPrescription }) => {
      const exp = explanations[item.drill.id];
      return (
        <FormQualityRecoveryCard
          prescription={item}
          explanation={
            exp
              ? {
                  isLoading: exp.isLoading,
                  text: exp.result?.explanation,
                  error: exp.result?.error,
                }
              : undefined
          }
          onRequestExplanation={handleExplain}
          onMarkDone={handleMarkDone}
          isDone={doneDrills.has(item.drill.id)}
        />
      );
    },
    [doneDrills, explanations, handleExplain, handleMarkDone]
  );

  return (
    <SafeAreaView style={screenStyles.container} edges={['top']} testID="form-quality-recovery-screen">
      <View style={screenStyles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="fqr-back"
        >
          <Ionicons name="arrow-back" size={24} color={tabColors.textPrimary} />
        </TouchableOpacity>
        <Text style={screenStyles.headerTitle}>Form Recovery</Text>
        <TouchableOpacity
          onPress={() => void refresh()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={isLoading}
          testID="fqr-refresh"
        >
          <Ionicons
            name="refresh"
            size={22}
            color={isLoading ? tabColors.textSecondary : tabColors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={screenStyles.stateContainer} testID="fqr-loading">
          <ActivityIndicator color={tabColors.accent} />
          <Text style={screenStyles.stateLabel}>Reviewing your session…</Text>
        </View>
      ) : !sessionId ? (
        <View style={screenStyles.stateContainer} testID="fqr-no-session">
          <Ionicons name="alert-circle-outline" size={48} color={tabColors.textSecondary} />
          <Text style={screenStyles.stateLabel}>No session selected.</Text>
          <Text style={screenStyles.stateSubtext}>
            Open this from a completed session in your history.
          </Text>
        </View>
      ) : error ? (
        <View style={screenStyles.stateContainer} testID="fqr-error">
          <Ionicons name="alert-circle-outline" size={48} color="#FF6B6B" />
          <Text style={screenStyles.stateLabel}>Could not load form data.</Text>
          <Text style={screenStyles.stateSubtext}>{error}</Text>
          <TouchableOpacity
            style={screenStyles.retryButton}
            onPress={() => void refresh()}
            testID="fqr-retry"
          >
            <Text style={screenStyles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={prescriptions}
          keyExtractor={(item) => item.drill.id}
          renderItem={renderItem}
          contentContainerStyle={screenStyles.list}
          ListHeaderComponent={
            <View style={screenStyles.summaryCard} testID="fqr-summary">
              <Text style={screenStyles.summaryLabel}>This session</Text>
              <View style={screenStyles.summaryRow}>
                <View style={screenStyles.summaryStat}>
                  <Text style={screenStyles.summaryValue}>{summary?.totalFaults ?? 0}</Text>
                  <Text style={screenStyles.summaryCaption}>faults</Text>
                </View>
                <View style={screenStyles.summaryStat}>
                  <Text style={screenStyles.summaryValue}>{summary?.exerciseCount ?? 0}</Text>
                  <Text style={screenStyles.summaryCaption}>exercises</Text>
                </View>
                <View style={screenStyles.summaryStat}>
                  <Text style={screenStyles.summaryValue}>{prescriptions.length}</Text>
                  <Text style={screenStyles.summaryCaption}>drills</Text>
                </View>
              </View>
              {prescriptions.length > 0 && (
                <Text style={screenStyles.summaryHint}>
                  Start with drill 1 — the highest-severity fix for what the camera saw.
                </Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={screenStyles.stateContainer} testID="fqr-empty">
              <Ionicons name="checkmark-circle-outline" size={48} color={tabColors.accent} />
              <Text style={screenStyles.stateLabel}>Clean session.</Text>
              <Text style={screenStyles.stateSubtext}>No drills prescribed for this workout.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const screenStyles = StyleSheet.create({
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
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  list: {
    padding: 16,
    paddingBottom: 80,
  },
  summaryCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    padding: 16,
    marginBottom: 16,
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 16,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  summaryCaption: {
    fontSize: 11,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryHint: {
    marginTop: 12,
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    lineHeight: 17,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 80,
  },
  stateLabel: {
    fontSize: 16,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
    marginTop: 12,
  },
  stateSubtext: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: tabColors.accent,
    borderRadius: 10,
  },
  retryButtonText: {
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
});

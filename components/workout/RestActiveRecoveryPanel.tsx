/**
 * RestActiveRecoveryPanel Component
 *
 * The main content block for the rest-timer sheet: a compact context
 * header (fatigue, muscle group) followed by BreathingCueCard,
 * MobilityDrillCard, ReflectionPromptCard, and a refresh button that
 * re-picks mobility + reflection content without restarting breathing.
 */

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/workout-session.styles';
import BreathingCueCard from './BreathingCueCard';
import MobilityDrillCard from './MobilityDrillCard';
import ReflectionPromptCard from './ReflectionPromptCard';
import type { BetweenSetsRecommendation } from '@/lib/services/between-sets-coach';

interface RestActiveRecoveryPanelProps {
  recommendation: BetweenSetsRecommendation | null;
  onRefresh?: () => void;
}

function formatFatigueLabel(score: number): string {
  if (score < 0.25) return 'Fresh';
  if (score < 0.5) return 'Moderate';
  if (score < 0.75) return 'High';
  return 'Max';
}

function fatigueTint(score: number): string {
  if (score < 0.25) return colors.success;
  if (score < 0.5) return colors.restActive;
  if (score < 0.75) return colors.warmup;
  return colors.dropset;
}

function RestActiveRecoveryPanel({
  recommendation,
  onRefresh,
}: RestActiveRecoveryPanelProps) {
  const handleRefresh = useCallback(() => {
    onRefresh?.();
  }, [onRefresh]);

  if (!recommendation) {
    return (
      <View style={styles.emptyContainer} testID="rest-active-recovery-empty">
        <Text style={styles.emptyText}>No active rest — complete a set to see recovery content.</Text>
      </View>
    );
  }

  const fatigueLabel = formatFatigueLabel(recommendation.fatigueScore);
  const tint = fatigueTint(recommendation.fatigueScore);

  return (
    <View style={styles.container} testID="rest-active-recovery-panel">
      <View style={styles.headerRow}>
        <View style={[styles.fatigueBadge, { borderColor: tint }]}>
          <Text style={[styles.fatigueBadgeText, { color: tint }]} testID="rest-fatigue-label">
            {fatigueLabel}
          </Text>
        </View>
        {recommendation.context.muscleGroup ? (
          <View style={styles.muscleBadge}>
            <Text style={styles.muscleText} testID="rest-muscle-group">
              {recommendation.context.muscleGroup}
            </Text>
          </View>
        ) : null}
        {onRefresh ? (
          <TouchableOpacity
            onPress={handleRefresh}
            style={styles.refreshButton}
            testID="rest-recommendation-refresh"
            accessibilityRole="button"
            accessibilityLabel="Refresh recovery content"
          >
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <BreathingCueCard pattern={recommendation.breathing} autoStart={true} />
      <MobilityDrillCard drill={recommendation.mobility} defaultExpanded={false} />
      <ReflectionPromptCard prompt={recommendation.reflection} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fatigueBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  fatigueBadgeText: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  muscleBadge: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  muscleText: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  refreshButton: {
    marginLeft: 'auto',
    padding: 6,
    borderRadius: 999,
    backgroundColor: colors.cardSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  emptyContainer: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default React.memo(RestActiveRecoveryPanel);

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type {
  Drill,
  DrillPrescription,
} from '@/lib/services/form-quality-recovery';
import { tabColors } from '@/styles/tabs/_tab-theme';

type ExplanationState = {
  isLoading: boolean;
  text?: string;
  error?: string;
};

interface FormQualityRecoveryCardProps {
  prescription: DrillPrescription;
  explanation?: ExplanationState;
  onRequestExplanation?: (drill: Drill) => void;
  onMarkDone?: (drillId: string) => void;
  isDone?: boolean;
  /**
   * When true, the card swaps the static reason copy for an inline
   * spinner + "Finding a drill for you…" caption. Use this while a
   * parent-controlled drill fetch (e.g. Gemma drill explainer, fault-
   * drill aggregator round-trip) is in flight so the user sees the
   * card is actively resolving instead of appearing frozen.
   *
   * Does NOT interact with the existing `explanation.isLoading` flag,
   * which remains scoped to the "Ask coach why" button's state.
   */
  isFetchingDrill?: boolean;
  testID?: string;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (s === 0) return `${m}min`;
  return `${m}m ${s}s`;
}

function categoryAccent(category: Drill['category']): string {
  switch (category) {
    case 'mobility':
      return '#8B5CF6';
    case 'activation':
      return '#F59E0B';
    case 'technique':
      return tabColors.accent;
    case 'strength':
      return '#10B981';
    default:
      return tabColors.accent;
  }
}

export function FormQualityRecoveryCard({
  prescription,
  explanation,
  onRequestExplanation,
  onMarkDone,
  isDone = false,
  isFetchingDrill = false,
  testID,
}: FormQualityRecoveryCardProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const { drill, reason, priority } = prescription;
  const accent = categoryAccent(drill.category);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((v) => !v);
  }, []);

  const handleRequestExplanation = useCallback(() => {
    onRequestExplanation?.(drill);
  }, [drill, onRequestExplanation]);

  const handleMarkDone = useCallback(() => {
    onMarkDone?.(drill.id);
  }, [drill.id, onMarkDone]);

  return (
    <View
      style={[cardStyles.card, isDone && cardStyles.cardDone]}
      testID={testID ?? `drill-card-${drill.id}`}
    >
      <View style={cardStyles.headerRow}>
        <View style={cardStyles.priorityBadge} testID={`drill-priority-${drill.id}`}>
          <Text style={cardStyles.priorityText}>{priority}</Text>
        </View>
        <View style={cardStyles.headerText}>
          <Text style={cardStyles.title} testID={`drill-title-${drill.id}`}>
            {drill.title}
          </Text>
          <View style={cardStyles.metaRow}>
            <View style={[cardStyles.categoryBadge, { backgroundColor: `${accent}22`, borderColor: accent }]}>
              <Text style={[cardStyles.categoryText, { color: accent }]}>{drill.category}</Text>
            </View>
            <Text style={cardStyles.duration}>{formatDuration(drill.durationSec)}</Text>
          </View>
        </View>
        {isDone && (
          <Ionicons name="checkmark-circle" size={24} color={tabColors.accent} testID={`drill-done-${drill.id}`} />
        )}
      </View>

      {isFetchingDrill ? (
        <View
          style={cardStyles.fetchingRow}
          testID={`drill-fetching-${drill.id}`}
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={tabColors.accent} size="small" />
          <Text style={cardStyles.fetchingText}>Finding a drill for you…</Text>
        </View>
      ) : (
        <Text style={cardStyles.reason} testID={`drill-reason-${drill.id}`}>
          {reason}
        </Text>
      )}

      <TouchableOpacity
        style={cardStyles.whyRow}
        onPress={toggleExpanded}
        testID={`drill-toggle-${drill.id}`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={cardStyles.whyLabel}>Why this drill?</Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={tabColors.textSecondary}
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={cardStyles.expandedBlock} testID={`drill-body-${drill.id}`}>
          <Text style={cardStyles.whyBody}>{drill.why}</Text>

          <Text style={cardStyles.stepsHeader}>Steps</Text>
          {drill.steps.map((step, i) => (
            <View key={`${drill.id}-step-${i}`} style={cardStyles.stepRow}>
              <Text style={cardStyles.stepNumber}>{i + 1}.</Text>
              <Text style={cardStyles.stepText}>{step}</Text>
            </View>
          ))}

          {onRequestExplanation && (
            <TouchableOpacity
              style={cardStyles.explainButton}
              onPress={handleRequestExplanation}
              disabled={explanation?.isLoading === true}
              testID={`drill-explain-${drill.id}`}
            >
              {explanation?.isLoading ? (
                <ActivityIndicator color={tabColors.accent} />
              ) : (
                <Text style={cardStyles.explainButtonText}>Ask coach why</Text>
              )}
            </TouchableOpacity>
          )}

          {explanation?.text && (
            <View style={cardStyles.explainBody} testID={`drill-explanation-${drill.id}`}>
              <Text style={cardStyles.explainLabel}>Coach</Text>
              <Text style={cardStyles.explainText}>{explanation.text}</Text>
            </View>
          )}

          {explanation?.error && !explanation.text && (
            <Text style={cardStyles.explainError} testID={`drill-explanation-error-${drill.id}`}>
              {explanation.error}
            </Text>
          )}
        </View>
      )}

      {onMarkDone && !isDone && (
        <TouchableOpacity
          style={cardStyles.doneButton}
          onPress={handleMarkDone}
          testID={`drill-mark-done-${drill.id}`}
        >
          <Text style={cardStyles.doneButtonText}>Mark done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    padding: 16,
    marginBottom: 12,
  },
  cardDone: {
    opacity: 0.6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 12,
  },
  priorityBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  priorityText: {
    fontSize: 13,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  categoryText: {
    fontSize: 11,
    fontFamily: 'Lexend_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  duration: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  reason: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginBottom: 10,
    lineHeight: 18,
  },
  fetchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  fetchingText: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    lineHeight: 18,
    flexShrink: 1,
  },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  whyLabel: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
  },
  expandedBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  whyBody: {
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textPrimary,
    lineHeight: 20,
    marginBottom: 12,
  },
  stepsHeader: {
    fontSize: 12,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  stepNumber: {
    fontSize: 13,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.accent,
    minWidth: 20,
  },
  stepText: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textPrimary,
    flex: 1,
    lineHeight: 19,
  },
  explainButton: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: tabColors.accent,
    alignItems: 'center',
  },
  explainButtonText: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.accent,
  },
  explainBody: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(60, 200, 169, 0.08)',
  },
  explainLabel: {
    fontSize: 10,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  explainText: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textPrimary,
    lineHeight: 19,
  },
  explainError: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: '#FF6B6B',
  },
  doneButton: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: tabColors.accent,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 13,
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
});

export default FormQualityRecoveryCard;

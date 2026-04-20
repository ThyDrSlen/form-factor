import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { MesocycleInsights } from '@/lib/services/form-mesocycle-aggregator';

export interface FormMesocycleCardProps {
  insights: MesocycleInsights | null;
  loading?: boolean;
  onPress?: () => void;
  onAskCoach?: () => void;
}

/**
 * Compact 4-week form-quality summary with a deload hint. Designed to
 * sit in a home-tab scroll without its own screen; tapping opens the
 * `/form-mesocycle` modal for the full breakdown.
 */
export function FormMesocycleCard({
  insights,
  loading,
  onPress,
  onAskCoach,
}: FormMesocycleCardProps) {
  if (loading && !insights) {
    return (
      <View style={styles.card} testID="form-mesocycle-card-loading">
        <Text style={styles.sectionTitle}>Form journey</Text>
        <Text style={styles.loadingText}>Loading your last 4 weeks…</Text>
      </View>
    );
  }

  if (!insights || insights.isEmpty) {
    return (
      <View style={styles.card} testID="form-mesocycle-card-empty">
        <Text style={styles.sectionTitle}>Form journey</Text>
        <Text style={styles.bodyText}>
          No tracked sessions in the last 4 weeks. Run a form-tracking set to
          start building your journey.
        </Text>
      </View>
    );
  }

  const latest = insights.weeks[insights.weeks.length - 1];
  const sparklineMax = Math.max(
    ...insights.weeks.map((w) => (w.avgFqi == null ? 0 : w.avgFqi)),
    100,
  );

  const deloadPalette = insights.deload.severity === 'deload'
    ? { icon: 'alert-circle' as const, tint: '#FF6B6B' }
    : insights.deload.severity === 'watch'
      ? { icon: 'eye-outline' as const, tint: '#FFB86C' }
      : { icon: 'checkmark-circle' as const, tint: '#4ADE80' };

  return (
    <Pressable
      onPress={onPress}
      testID="form-mesocycle-card"
      accessibilityRole="button"
      accessibilityLabel="Open form journey details"
    >
      <LinearGradient
        colors={['#0F2339', '#081526']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Form journey · 4 weeks</Text>
          <Ionicons name="chevron-forward" size={20} color="#8FA2B8" />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.primaryStat}>
            <Text style={styles.primaryValue} testID="form-mesocycle-current-fqi">
              {latest.avgFqi == null ? '—' : latest.avgFqi}
            </Text>
            <Text style={styles.primaryLabel}>Current-week FQI</Text>
          </View>
          <View style={styles.sparkline} testID="form-mesocycle-sparkline">
            {insights.weeks.map((week) => (
              <View
                key={week.weekStartIso}
                style={[
                  styles.sparkBar,
                  {
                    height: week.avgFqi == null ? 4 : (week.avgFqi / sparklineMax) * 48,
                    backgroundColor:
                      week.avgFqi == null ? '#2D3A4A' : '#4C8CFF',
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {insights.topFaults.length > 0 ? (
          <View style={styles.faultsRow} testID="form-mesocycle-top-faults">
            {insights.topFaults.map((fault) => (
              <View key={fault.fault} style={styles.faultChip}>
                <Text style={styles.faultChipText}>{formatFault(fault.fault)}</Text>
                <Text style={styles.faultChipCount}>{fault.count}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.deloadRow} testID="form-mesocycle-deload">
          <Ionicons
            name={deloadPalette.icon}
            size={18}
            color={deloadPalette.tint}
          />
          <Text style={[styles.deloadText, { color: deloadPalette.tint }]}>
            {insights.deload.reason ?? 'Steady progress — keep the current block going.'}
          </Text>
        </View>

        {onAskCoach ? (
          <Pressable
            onPress={onAskCoach}
            style={styles.askCoachButton}
            testID="form-mesocycle-ask-coach"
            accessibilityRole="button"
            accessibilityLabel="Ask the coach for a mesocycle review"
          >
            <Ionicons name="sparkles" size={16} color="#4C8CFF" />
            <Text style={styles.askCoachText}>Ask coach for a review</Text>
          </Pressable>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

function formatFault(code: string): string {
  return code
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  sectionTitle: {
    color: '#E1E8EF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 14,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  loadingText: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    marginTop: 8,
  },
  bodyText: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 20,
  },
  primaryStat: {
    flex: 1,
  },
  primaryValue: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 44,
  },
  primaryLabel: {
    color: '#8FA2B8',
    fontFamily: 'Lexend_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  sparkline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 48,
  },
  sparkBar: {
    width: 10,
    borderRadius: 2,
  },
  faultsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  faultChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1F2D40',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  faultChipText: {
    color: '#E1E8EF',
    fontFamily: 'Lexend_400Regular',
    fontSize: 12,
  },
  faultChipCount: {
    color: '#4C8CFF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 12,
  },
  deloadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
  },
  deloadText: {
    flex: 1,
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  askCoachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
  },
  askCoachText: {
    color: '#4C8CFF',
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
  },
});

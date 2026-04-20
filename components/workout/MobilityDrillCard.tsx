/**
 * MobilityDrillCard Component
 *
 * Renders a MobilityDrill with its target muscle tags, duration, and
 * an expandable step list.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/workout-session.styles';
import type { MobilityDrill } from '@/lib/services/mobility-drills';

interface MobilityDrillCardProps {
  drill: MobilityDrill;
  defaultExpanded?: boolean;
}

function MobilityDrillCard({ drill, defaultExpanded = false }: MobilityDrillCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = useCallback(() => {
    setExpanded((e) => !e);
  }, []);

  const intensityColor = drill.intensity === 'moderate' ? colors.warmup : colors.restActive;

  return (
    <View style={styles.card} testID="mobility-drill-card">
      <TouchableOpacity
        onPress={toggle}
        style={styles.header}
        testID="mobility-drill-toggle"
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse drill steps' : 'Expand drill steps'}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.title} testID="mobility-drill-name">
            {drill.name}
          </Text>
          <View style={styles.tagRow}>
            <View style={[styles.tag, { borderColor: intensityColor }]}>
              <Text style={[styles.tagText, { color: intensityColor }]}>
                {drill.intensity}
              </Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{drill.durationSeconds}s</Text>
            </View>
          </View>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
      <Text style={styles.description}>{drill.description}</Text>
      {expanded ? (
        <View style={styles.steps} testID="mobility-drill-steps">
          {drill.steps.map((step, idx) => (
            <View key={`${drill.id}-step-${idx}`} style={styles.stepRow}>
              <View style={styles.stepBullet}>
                <Text style={styles.stepBulletText}>{idx + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardSurface,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 15,
    color: colors.textPrimary,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tag: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tagText: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 11,
    color: colors.textSecondary,
  },
  description: {
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },
  steps: {
    gap: 8,
    paddingTop: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBulletText: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  stepText: {
    flex: 1,
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});

export default React.memo(MobilityDrillCard);

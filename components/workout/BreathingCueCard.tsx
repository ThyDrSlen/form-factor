/**
 * BreathingCueCard Component
 *
 * Renders a breathing pattern as a timed phase-cycler. Tracks progress
 * through the pattern's phases in local state and loops through cycles
 * until explicitly paused. Visualization is a simple phase badge + cue
 * line — no animation engine required, just a seconds countdown that
 * advances through the phase list.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@/styles/workout-session.styles';
import type { BreathingPattern, BreathingPhase } from '@/lib/services/breathing-patterns';

interface BreathingCueCardProps {
  pattern: BreathingPattern;
  /** Auto-start the breathing cycle on mount. */
  autoStart?: boolean;
  /** Emit each phase transition. */
  onPhaseChange?: (phase: BreathingPhase, phaseIndex: number) => void;
}

const PHASE_LABEL: Record<BreathingPhase['type'], string> = {
  inhale: 'Inhale',
  'hold-in': 'Hold',
  exhale: 'Exhale',
  'hold-out': 'Hold',
};

function BreathingCueCard({ pattern, autoStart = true, onPhaseChange }: BreathingCueCardProps) {
  const [running, setRunning] = useState<boolean>(autoStart);
  const [phaseIndex, setPhaseIndex] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(pattern.phases[0]?.seconds ?? 0);

  useEffect(() => {
    setPhaseIndex(0);
    setSecondsLeft(pattern.phases[0]?.seconds ?? 0);
  }, [pattern]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev > 1) return prev - 1;
        setPhaseIndex((idx) => {
          const next = (idx + 1) % pattern.phases.length;
          const phase = pattern.phases[next];
          setSecondsLeft(phase.seconds);
          onPhaseChange?.(phase, next);
          return next;
        });
        return pattern.phases[(phaseIndex + 1) % pattern.phases.length]?.seconds ?? 0;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, pattern, phaseIndex, onPhaseChange]);

  const toggle = useCallback(() => {
    setRunning((r) => !r);
  }, []);

  const currentPhase = pattern.phases[phaseIndex];
  const phaseColor = currentPhase.type.startsWith('inhale')
    ? colors.success
    : currentPhase.type.startsWith('exhale')
      ? colors.accent
      : colors.restActive;

  return (
    <View style={styles.card} testID="breathing-cue-card">
      <View style={styles.header}>
        <Text style={styles.title} testID="breathing-pattern-name">
          {pattern.name}
        </Text>
        <TouchableOpacity
          onPress={toggle}
          style={styles.toggleButton}
          testID="breathing-toggle"
          accessibilityRole="button"
          accessibilityLabel={running ? 'Pause breathing guide' : 'Start breathing guide'}
        >
          <Text style={styles.toggleText}>{running ? 'Pause' : 'Start'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.description}>{pattern.description}</Text>
      <View style={[styles.phaseBadge, { borderColor: phaseColor }]} testID="breathing-phase">
        <Text style={[styles.phaseLabel, { color: phaseColor }]}>
          {PHASE_LABEL[currentPhase.type]}
        </Text>
        <Text style={styles.phaseCue}>{currentPhase.cue}</Text>
        <Text style={[styles.phaseSeconds, { color: phaseColor }]} testID="breathing-seconds">
          {secondsLeft}s
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardSurface,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.restActive,
  },
  toggleText: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 12,
    color: colors.background,
  },
  description: {
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },
  phaseBadge: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  phaseLabel: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 18,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  phaseCue: {
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },
  phaseSeconds: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 28,
  },
});

export default React.memo(BreathingCueCard);

/**
 * DrillSheet
 *
 * Bottom sheet opened from CueCard's `onPress` prop when a fault is
 * active and the user wants to remediate it. Lists the faults's
 * attached drills with steps + duration.
 *
 * Logs view/start/dismiss via drill-tracker.
 */
import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FaultDefinition, FaultDrill } from '@/lib/types/workout-definitions';
import { drillTracker } from '@/lib/services/drill-tracker';

interface DrillSheetProps {
  visible: boolean;
  fault: FaultDefinition | null;
  exerciseId: string;
  sessionId: string | null;
  onDismiss: () => void;
  onStartDrill?: (drill: FaultDrill) => void;
  testID?: string;
}

export function DrillSheet({
  visible,
  fault,
  exerciseId,
  sessionId,
  onDismiss,
  onStartDrill,
  testID,
}: DrillSheetProps) {
  const drills = fault?.drills ?? [];

  useEffect(() => {
    if (!visible || !fault || !sessionId) return;
    for (const d of drills) {
      void drillTracker.markViewed({
        sessionId,
        exerciseId,
        faultId: fault.id,
        drillId: d.id,
      });
    }
    // only re-run when the sheet is opened with a different fault
  }, [visible, fault, drills, exerciseId, sessionId]);

  const handleStart = (drill: FaultDrill) => {
    if (sessionId && fault) {
      void drillTracker.markStarted({
        sessionId,
        exerciseId,
        faultId: fault.id,
        drillId: drill.id,
      });
    }
    onStartDrill?.(drill);
  };

  const handleDismiss = () => {
    if (sessionId && fault) {
      for (const d of drills) {
        void drillTracker.markDismissed({
          sessionId,
          exerciseId,
          faultId: fault.id,
          drillId: d.id,
        });
      }
    }
    onDismiss();
  };

  if (!fault) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      testID={testID ?? 'drill-sheet'}
    >
      <Pressable style={styles.backdrop} onPress={handleDismiss} accessibilityRole="button" />
      <View style={styles.sheet} accessibilityLabel={`Corrective drills for ${fault.displayName}`}>
        <View style={styles.handle} />
        <Text style={styles.kicker}>Fix: {fault.displayName}</Text>
        <Text style={styles.subtitle}>{fault.dynamicCue}</Text>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {drills.length === 0 ? (
            <Text style={styles.empty}>No drills available yet for this fault.</Text>
          ) : (
            drills.map((drill, idx) => (
              <View
                key={drill.id}
                style={styles.drillCard}
                testID={`${testID ?? 'drill-sheet'}-drill-${idx}`}
              >
                <View style={styles.drillHeader}>
                  <Text style={styles.drillTitle}>{drill.title}</Text>
                  <Text style={styles.drillDuration}>{formatDuration(drill)}</Text>
                </View>
                <View style={styles.steps}>
                  {drill.steps.map((step, i) => (
                    <Text key={i} style={styles.step}>
                      {i + 1}. {step}
                    </Text>
                  ))}
                </View>
                <Pressable
                  onPress={() => handleStart(drill)}
                  style={({ pressed }) => [styles.startBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  testID={`${testID ?? 'drill-sheet'}-drill-${idx}-start`}
                >
                  <Text style={styles.startText}>Start Drill</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>

        <Pressable
          onPress={handleDismiss}
          style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          testID={`${testID ?? 'drill-sheet'}-dismiss`}
        >
          <Text style={styles.dismissText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function formatDuration(drill: FaultDrill): string {
  const parts: string[] = [];
  if (drill.reps) parts.push(`${drill.reps} reps`);
  if (drill.durationSec) {
    const min = Math.floor(drill.durationSec / 60);
    const sec = drill.durationSec % 60;
    parts.push(min > 0 ? `${min}m ${sec ? `${sec}s` : ''}`.trim() : `${sec}s`);
  }
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    backgroundColor: '#0D1530',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 36,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 12,
  },
  kicker: {
    color: '#FF9E9E',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#F5F7FF',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 10,
  },
  list: {
    maxHeight: 440,
  },
  listContent: {
    gap: 12,
    paddingBottom: 12,
  },
  empty: {
    color: 'rgba(220, 228, 245, 0.6)',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  drillCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  drillHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drillTitle: {
    color: '#F5F7FF',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
  },
  drillDuration: {
    color: 'rgba(220, 228, 245, 0.7)',
    fontSize: 12,
  },
  steps: {
    marginTop: 8,
    gap: 4,
  },
  step: {
    color: 'rgba(220, 228, 245, 0.85)',
    fontSize: 13,
    lineHeight: 18,
  },
  startBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#4C8CFF',
  },
  startText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  dismissBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dismissText: {
    color: 'rgba(220, 228, 245, 0.7)',
    fontSize: 14,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.75,
  },
});

export default DrillSheet;

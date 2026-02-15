/**
 * SessionMetaCard Component
 *
 * Shows session metadata: name, start/end time, bodyweight, notes.
 */

import React, { useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import type { WorkoutSession } from '@/lib/types/workout-session';

interface SessionMetaCardProps {
  session: WorkoutSession;
  onUpdateSession: (fields: Partial<WorkoutSession>) => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function SessionMetaCard({ session, onUpdateSession }: SessionMetaCardProps) {
  const handleNameChange = useCallback(
    (text: string) => onUpdateSession({ name: text || null }),
    [onUpdateSession],
  );

  const handleBodyweightChange = useCallback(
    (text: string) => {
      const val = text ? parseFloat(text) : null;
      onUpdateSession({ bodyweight_lb: val });
    },
    [onUpdateSession],
  );

  return (
    <View style={styles.metaCard}>
      {/* Name */}
      <View style={styles.metaRow}>
        <Text style={[styles.metaLabel, { color: colors.accent }]}>Name</Text>
        <TextInput
          style={styles.metaInput}
          value={session.name ?? ''}
          onChangeText={handleNameChange}
          placeholder="Optional"
          placeholderTextColor={colors.textSecondary}
        />
      </View>

      {/* Start Time */}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Start Time</Text>
        <Text style={styles.metaValue}>{formatDateTime(session.started_at)}</Text>
      </View>

      {/* End Time */}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>End Time</Text>
        <Text style={styles.metaValue}>
          {session.ended_at ? formatDateTime(session.ended_at) : '-'}
        </Text>
      </View>

      {/* Bodyweight */}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Bodyweight (lb)</Text>
        <TextInput
          style={styles.metaInput}
          value={session.bodyweight_lb != null ? String(session.bodyweight_lb) : ''}
          onChangeText={handleBodyweightChange}
          keyboardType="numeric"
          placeholder="-"
          placeholderTextColor={colors.textSecondary}
        />
      </View>

      {/* Notes */}
      <TouchableOpacity style={[styles.metaRow, styles.metaRowLast]}>
        <Text style={styles.metaLabel}>Notes</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

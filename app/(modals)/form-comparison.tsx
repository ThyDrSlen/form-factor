/**
 * Form-comparison modal — side-by-side metrics for the current session vs
 * the user's most recent prior session on the same exercise.
 *
 * Launched via deep link: `/form-comparison?sessionId=...&exerciseId=...`
 * (both params required). Shows a baseline card when no prior session exists.
 */

import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionComparisonQuery } from '@/hooks/use-session-comparison';
import { SessionComparisonCard } from '@/components/form-journey/SessionComparisonCard';

export default function FormComparisonModal() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ sessionId?: string; exerciseId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
  const exerciseId = typeof params.exerciseId === 'string' ? params.exerciseId : null;

  const { comparison, loading, error, reload } = useSessionComparisonQuery({
    currentSessionId: sessionId,
    exerciseId,
    userId: user?.id ?? null,
  });

  const paramsValid = useMemo(
    () => Boolean(sessionId && exerciseId && user?.id),
    [sessionId, exerciseId, user?.id],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Close comparison"
          testID="close-button"
        >
          <Ionicons name="close" size={24} color="#F8F9FF" />
        </TouchableOpacity>
        <Text style={styles.title}>Form comparison</Text>
        <View style={styles.closeButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        testID="form-comparison-scroll"
      >
        {!paramsValid && (
          <View style={styles.empty} testID="empty-state">
            <Ionicons name="information-circle-outline" size={32} color="#8B97B3" />
            <Text style={styles.emptyTitle}>Pick a session and exercise</Text>
            <Text style={styles.emptyBody}>
              Open this screen from a finished session to see how it compares
              to your previous attempt on the same lift.
            </Text>
          </View>
        )}

        {paramsValid && loading && (
          <View style={styles.loading} testID="loading-state">
            <ActivityIndicator size="small" color="#6366F1" />
            <Text style={styles.loadingText}>Loading comparison…</Text>
          </View>
        )}

        {paramsValid && error && !loading && (
          <View style={styles.errorBox} testID="error-state">
            <Ionicons name="alert-circle-outline" size={20} color="#EF4444" />
            <Text style={styles.errorText}>{error.message}</Text>
            <TouchableOpacity
              onPress={() => void reload()}
              style={styles.retryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry loading comparison"
              testID="retry-button"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {paramsValid && !loading && !error && comparison && (
          <SessionComparisonCard comparison={comparison} />
        )}

        {paramsValid && !loading && !error && !comparison && (
          <View style={styles.empty} testID="no-data-state">
            <Ionicons name="pulse-outline" size={32} color="#8B97B3" />
            <Text style={styles.emptyTitle}>Nothing to compare yet</Text>
            <Text style={styles.emptyBody}>
              No reps recorded for {exerciseId ?? 'this exercise'} in
              the current session.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F8F9FF',
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#F8F9FF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyBody: {
    color: '#8B97B3',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  loading: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#8B97B3',
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: '#2A1220',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    alignItems: 'flex-start',
  },
  errorText: {
    color: '#F8B7B7',
    fontSize: 13,
  },
  retryButton: {
    backgroundColor: '#EF4444',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

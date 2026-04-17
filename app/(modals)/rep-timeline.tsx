/**
 * Rep Timeline Modal
 *
 * Post-session drilldown screen that renders the rep-quality log for a given
 * `sessionId` (via URL param). Deep-linked from session-history cards and
 * the form-quality-recovery flow once those surfaces mount it.
 */

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import RepTimelineCard from '@/components/form-tracking/RepTimelineCard';
import { useRepQualityTimeline } from '@/hooks/use-rep-quality-timeline';
import { summarizeTimeline } from '@/lib/services/rep-quality-timeline';

export default function RepTimelineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;

  const timeline = useRepQualityTimeline({ sessionId });
  const handleClose = useCallback(() => {
    const canGoBack = (router as unknown as { canGoBack?: () => boolean }).canGoBack?.() ?? true;
    if (canGoBack) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  const hasSession = Boolean(sessionId);

  return (
    <SafeAreaView style={styles.container} testID="rep-timeline-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close rep timeline"
          style={styles.closeButton}
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rep timeline</Text>
        <View style={styles.spacer} />
      </View>

      {!hasSession ? (
        <View style={styles.missingBody}>
          <Text style={styles.missingTitle}>Missing session</Text>
          <Text style={styles.missingSub}>
            Open this screen from a session card to see its rep-by-rep history.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.subtitle}>{summarizeTimeline(timeline)}</Text>
          <RepTimelineCard timeline={timeline} testID="rep-timeline-card" />
        </View>
      )}
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  spacer: { width: 40 },
  body: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  missingBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  missingTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  missingSub: {
    color: '#9CA3AF',
    textAlign: 'center',
    fontSize: 14,
  },
});

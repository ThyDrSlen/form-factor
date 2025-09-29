import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useHealthKit } from '@/contexts/HealthKitContext';
import { getHealthKitGuidance } from '@/components/health-kit/healthkit-guidance';

interface StatProps {
  label: string;
  value: string;
  sublabel?: string;
}

function StatCard({ label, value, sublabel, isStale }: StatProps & { isStale?: boolean }) {
  return (
    <LinearGradient
      colors={['#0F2339', '#081526']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.statCard}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.statNumber}>{value}</Text>
        {isStale && <Ionicons name="alert-circle" size={18} color="#FF6B6B" />}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      {sublabel ? <Text style={[styles.statSublabel, isStale && { color: '#FF6B6B' }]}>{sublabel}</Text> : null}
    </LinearGradient>
  );
}

export function DashboardHealth() {
  const { status, isLoading, stepsToday, latestHeartRate, requestPermissions } = useHealthKit();

  // Hide HealthKit UI on non-iOS platforms (e.g., web, Android)
  const isIOS = Platform.OS === 'ios';
  if (!isIOS) {
    return null;
  }

  const hasRead = Boolean(status?.hasReadPermission);
  const guidance = getHealthKitGuidance({ status, isLoading });

  if (!hasRead) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Health</Text>
        <LinearGradient
          colors={['#0F2339', '#081526']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.permissionCard}
        >
          <Text style={styles.permissionTitle}>{guidance.headline}</Text>
          <Text style={styles.permissionText}>{guidance.description}</Text>
          <TouchableOpacity
            onPress={requestPermissions}
            accessibilityRole="button"
            style={styles.ctaButton}
            disabled={guidance.primaryDisabled}
          >
            <Text style={styles.ctaText}>
              {isLoading ? 'Requesting…' : guidance.primaryCtaLabel}
            </Text>
          </TouchableOpacity>
          {guidance.showSettingsShortcut ? (
            <TouchableOpacity
              onPress={() => Linking.openSettings()}
              accessibilityRole="button"
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Open iOS Settings</Text>
            </TouchableOpacity>
          ) : null}
          {guidance.footnote ? (
            <Text style={styles.permissionFootnote}>{guidance.footnote}</Text>
          ) : null}
        </LinearGradient>
      </View>
    );
  }

  const stepsDisplay = stepsToday == null ? '—' : new Intl.NumberFormat().format(Math.max(0, stepsToday));
  const hrBpm = latestHeartRate?.bpm ?? null;
  const hrTime = latestHeartRate?.timestamp ? new Date(latestHeartRate.timestamp) : null;
  const hrIsStale = hrTime ? (Date.now() - hrTime.getTime() > 1000 * 60 * 15) : false; // >15min = stale
  const hrSublabel = hrTime ? `${hrTime.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : undefined;
  const hrDisplay = hrBpm == null ? '—' : `${Math.round(hrBpm)} bpm`;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Health</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Steps Today" value={stepsDisplay} />
        <StatCard label="Heart Rate" value={hrDisplay} sublabel={hrSublabel} isStale={hrIsStale} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4C8CFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#9AACD1',
    textAlign: 'center',
  },
  statSublabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#6781A6',
  },
  permissionCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 6,
  },
  permissionText: {
    fontSize: 14,
    color: '#9AACD1',
    marginBottom: 12,
  },
  ctaButton: {
    backgroundColor: '#4C8CFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryText: {
    color: '#4C8CFF',
    fontWeight: '600',
  },
  permissionFootnote: {
    marginTop: 8,
    fontSize: 12,
    color: '#6781A6',
  },
});

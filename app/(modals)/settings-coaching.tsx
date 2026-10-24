import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';

import { CoachModelCard } from '@/features/coach/components/settings/CoachModelCard';
import { CoachModelTierCard } from '@/features/coach/components/settings/CoachModelTierCard';
import { CoachRoutingPreference } from '@/features/coach/components/settings/CoachRoutingPreference';
import { CostDashboardCard } from '@/features/coach/components/settings/CostDashboardCard';
import { useOnDeviceModelStatus } from '@/features/coach/hooks/use-on-device-model-status';
import {
  ON_DEVICE_ROUTING_STORAGE_KEY,
  getOnDeviceRoutingPreference,
  setOnDeviceRoutingPreference,
  type OnDeviceRoutingPreference as RoutingPref,
} from '@/lib/ai/config';
import {
  DEFAULT_COACH_MODEL_TIER,
  getModelTier,
  setModelTier,
  type CoachModelTier,
} from '@/lib/services/coach-model-tier-preference';
import { useSafeBack } from '@/hooks/use-safe-back';

export const COACH_ROUTING_PREFERENCE_KEY = ON_DEVICE_ROUTING_STORAGE_KEY;

export default function SettingsCoachingModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });
  const modelState = useOnDeviceModelStatus();
  const [preference, setPreference] = useState<RoutingPref>('cloud_only');
  const [tier, setTier] = useState<CoachModelTier>(DEFAULT_COACH_MODEL_TIER);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getOnDeviceRoutingPreference(),
      getModelTier(),
    ]).then(([storedPref, storedTier]) => {
      if (!alive) return;
      if (storedPref) {
        setPreference(storedPref);
      }
      setTier(storedTier);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handlePreferenceChange = useCallback((next: RoutingPref) => {
    setPreference(next);
    setOnDeviceRoutingPreference(next).catch(() => {
      // Non-fatal — UI already reflects the choice. A future sync will
      // re-attempt on navigation.
    });
  }, []);

  const handleTierChange = useCallback((next: CoachModelTier) => {
    setTier(next);
    void setModelTier(next);
  }, []);

  const localDisabled = modelState.status !== 'ready';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.backButton} accessibilityLabel="Close">
          <Ionicons name="arrow-back" size={24} color="#E8EDF5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Coaching</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          On-device model
        </Text>
        <CoachModelCard
          status={modelState.status}
          progress={modelState.progress}
          errorMessage={modelState.errorMessage}
          modelId={modelState.modelId}
        />

        <View style={styles.divider} />

        <Text variant="titleMedium" style={styles.sectionTitle}>
          Routing preference
        </Text>
        {loaded && (
          <CoachRoutingPreference
            value={preference}
            onChange={handlePreferenceChange}
            localDisabled={localDisabled}
          />
        )}

        <View style={styles.divider} />

        <Text variant="titleMedium" style={styles.sectionTitle}>
          Speed vs quality
        </Text>
        {loaded && <CoachModelTierCard value={tier} onChange={handleTierChange} />}

        <View style={styles.divider} />

        <Text variant="titleMedium" style={styles.sectionTitle}>
          Weekly usage
        </Text>
        <CostDashboardCard />
      </ScrollView>
    </View>
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
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#050E1F',
    borderBottomWidth: 1,
    borderBottomColor: '#1B2E4A',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: '#E8EDF5',
    textAlign: 'center',
    marginRight: 40,
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
  },
  sectionTitle: {
    color: '#E8EDF5',
    marginTop: 16,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#1B2E4A',
    marginVertical: 16,
  },
});

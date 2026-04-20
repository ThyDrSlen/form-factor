import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CoachModelCard } from '@/components/settings/CoachModelCard';
import { CoachRoutingPreference } from '@/components/settings/CoachRoutingPreference';
import {
  getStatus as getCoachModelStatus,
  subscribe as subscribeCoachModel,
  type CoachModelState,
} from '@/lib/services/coach-model-manager';
import type { CoachRoutingPreference as RoutingPref } from '@/lib/services/coach-dispatch';
import { useSafeBack } from '@/hooks/use-safe-back';

export const COACH_ROUTING_PREFERENCE_KEY = 'coach_routing_preference';

const ROUTING_VALUES: RoutingPref[] = ['cloud_only', 'prefer_local', 'local_only'];

function isRoutingPref(v: string | null | undefined): v is RoutingPref {
  return !!v && (ROUTING_VALUES as string[]).includes(v);
}

export default function SettingsCoachingModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile'], { alwaysReplace: true });
  const [modelState, setModelState] = useState<CoachModelState>(getCoachModelStatus());
  const [preference, setPreference] = useState<RoutingPref>('cloud_only');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeCoachModel(setModelState);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(COACH_ROUTING_PREFERENCE_KEY).then((stored) => {
      if (!alive) return;
      if (isRoutingPref(stored)) {
        setPreference(stored);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handlePreferenceChange = useCallback((next: RoutingPref) => {
    setPreference(next);
    AsyncStorage.setItem(COACH_ROUTING_PREFERENCE_KEY, next).catch(() => {
      // Non-fatal — UI already reflects the choice. A future sync will
      // re-attempt on navigation.
    });
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

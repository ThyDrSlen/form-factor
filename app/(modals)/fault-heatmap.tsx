import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FaultHeatmapThumb, type FaultCell } from '@/components/form-home/FaultHeatmapThumb';

/**
 * Full-screen fault heatmap modal (issue #470).
 *
 * Intentionally data-light: reads synthetic placeholder data locally so it
 * renders without coupling to the form-home data hook. Future PRs can wire
 * it to `useFormHomeData` via route params or context.
 */
export default function FaultHeatmapModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { cells, days } = useMemo(() => {
    const today = new Date();
    const d: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const copy = new Date(today);
      copy.setDate(today.getDate() - i);
      d.push(`${copy.getMonth() + 1}/${copy.getDate()}`);
    }
    // Lightweight placeholder fault data — real data is injected by the
    // form-home hook in a future PR; the route still needs to render
    // deterministically when opened standalone.
    const placeholder: FaultCell[] = [];
    return { cells: placeholder, days: d };
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close fault heatmap"
          onPress={() => router.back()}
          style={styles.closeButton}
          testID="fault-heatmap-close"
        >
          <Ionicons name="close" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.title}>Fault heatmap</Text>
        <View style={styles.closeButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <FaultHeatmapThumb cells={cells} days={days} />
        <Text style={styles.legendTitle}>How to read this</Text>
        <Text style={styles.legendBody}>
          Each row is one of your top three detected faults over the last
          seven days. Darker cells mean the fault fired more often on that
          day. Tap Start form session to work on your highest-fault pattern.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050E1F',
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 17,
    fontWeight: '700',
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 40,
  },
  legendTitle: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
  },
  legendBody: {
    color: '#97A3C2',
    fontSize: 13,
    lineHeight: 18,
  },
});

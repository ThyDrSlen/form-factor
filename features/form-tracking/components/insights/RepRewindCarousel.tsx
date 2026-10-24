import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';

// NOTE: Video scrubbing per rep is intentionally deferred until #434
// (PostSessionSummaryCard + media capture wiring) merges. This carousel
// currently renders metrics-only cards.

export interface RepRewindItem {
  repId: string;
  repIndex: number;
  fqi: number | null;
  romDeg: number | null;
  durationMs: number;
  faults: string[];
  side: string | null;
  startTs: string;
}

interface Props {
  /** Limit to a single session when provided. Otherwise falls back to exerciseId + recent window. */
  sessionId?: string;
  exerciseId?: string;
  /** Max number of cards to render. Default 20. */
  limit?: number;
  /** Optional pre-fetched data for preview/tests. */
  initialData?: RepRewindItem[] | null;
}

function featureNumber(features: unknown, key: string): number | null {
  if (!features || typeof features !== 'object') return null;
  const rec = features as Record<string, unknown>;
  const v = rec[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

async function loadReps(scope: { sessionId?: string; exerciseId?: string }, limit: number): Promise<RepRewindItem[]> {
  try {
    let query = supabase
      .from('reps')
      .select('rep_id,rep_index,fqi,start_ts,end_ts,features,faults_detected,side');

    if (scope.sessionId) {
      query = query.eq('session_id', scope.sessionId);
    }
    if (scope.exerciseId) {
      query = query.eq('exercise', scope.exerciseId);
    }

    const { data, error } = await query.order('start_ts', { ascending: false }).limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as {
      rep_id: string;
      rep_index: number;
      fqi: number | null;
      start_ts: string;
      end_ts: string;
      features: unknown;
      faults_detected: string[] | null;
      side: string | null;
    }[];

    return rows.map((r) => ({
      repId: r.rep_id,
      repIndex: r.rep_index,
      fqi: typeof r.fqi === 'number' ? r.fqi : null,
      romDeg: featureNumber(r.features, 'romDeg') ?? featureNumber(r.features, 'rom_deg'),
      durationMs: Math.max(0, new Date(r.end_ts).getTime() - new Date(r.start_ts).getTime()),
      faults: Array.isArray(r.faults_detected) ? r.faults_detected : [],
      side: r.side,
      startTs: r.start_ts,
    }));
  } catch (error) {
    errorWithTs('[RepRewindCarousel] loadReps failed', error);
    return [];
  }
}

function fqiColor(fqi: number | null): string {
  if (fqi === null) return '#6781A6';
  if (fqi >= 80) return '#3CC8A9';
  if (fqi >= 60) return '#F59E0B';
  return '#EF4444';
}

export function RepRewindCarousel({ sessionId, exerciseId, limit = 20, initialData }: Props) {
  const [data, setData] = useState<RepRewindItem[] | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    if (!sessionId && !exerciseId) {
      setData([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const next = await loadReps({ sessionId, exerciseId }, limit);
      if (!cancelled) {
        setData(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, exerciseId, limit, initialData]);

  const renderItem = React.useCallback(({ item }: { item: RepRewindItem }) => {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.repNumber}>Rep {item.repIndex}</Text>
          {item.side && <Text style={styles.side}>{item.side}</Text>}
        </View>
        <Text style={[styles.fqi, { color: fqiColor(item.fqi) }]}>{item.fqi ?? '--'}</Text>
        <Text style={styles.fqiLabel}>FQI</Text>

        <View style={styles.statRow}>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>ROM</Text>
            <Text style={styles.statValue}>
              {item.romDeg === null ? '--' : `${item.romDeg.toFixed(0)}°`}
            </Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>Time</Text>
            <Text style={styles.statValue}>
              {item.durationMs === 0 ? '--' : `${(item.durationMs / 1000).toFixed(1)}s`}
            </Text>
          </View>
        </View>

        {item.faults.length > 0 ? (
          <View style={styles.faultRow}>
            {item.faults.slice(0, 2).map((f) => (
              <View key={f} style={styles.faultChip}>
                <Text style={styles.faultText}>{f}</Text>
              </View>
            ))}
            {item.faults.length > 2 && <Text style={styles.faultMore}>+{item.faults.length - 2}</Text>}
          </View>
        ) : (
          <View style={styles.faultRow}>
            <Text style={styles.cleanText}>Clean rep</Text>
          </View>
        )}
      </View>
    );
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerOuter}>
        <Text style={styles.title}>Rep Rewind</Text>
        <Text style={styles.subtitle}>Scroll through recent reps. Tap to coach (video coming in #434).</Text>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#4C8CFF" />
        </View>
      ) : !data || data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No reps to rewind in this scope.</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.repId}
          renderItem={renderItem}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

export default RepRewindCarousel;

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  headerOuter: {
    paddingHorizontal: 14,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9AACD1',
    marginTop: 4,
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: 14,
    gap: 10,
  },
  card: {
    backgroundColor: '#12243A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    padding: 14,
    width: 148,
    marginRight: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  repNumber: {
    color: '#DCE5F5',
    fontSize: 13,
    fontWeight: '700',
  },
  side: {
    color: '#9AACD1',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  fqi: {
    fontSize: 36,
    fontWeight: '800',
    marginTop: 6,
  },
  fqiLabel: {
    color: '#9AACD1',
    fontSize: 11,
    marginTop: -4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  statCol: {
    flex: 1,
  },
  statLabel: {
    color: '#9AACD1',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#F5F7FF',
    fontWeight: '700',
    marginTop: 2,
  },
  faultRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  faultChip: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  faultText: {
    color: '#F8D7D7',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  faultMore: {
    color: '#9AACD1',
    fontSize: 10,
    fontWeight: '700',
  },
  cleanText: {
    color: '#3CC8A9',
    fontSize: 11,
    fontWeight: '700',
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9AACD1',
    fontSize: 13,
  },
});

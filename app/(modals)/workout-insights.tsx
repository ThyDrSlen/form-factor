import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  GestureResponderEvent,
  LayoutChangeEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import {
  fetchWorkoutInsightsSnapshot,
  type DriverCard,
  type WorkoutInsightsSnapshot,
} from '@/lib/services/workout-insights';

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - 40;
const chartHeight = 220;

function severityColor(severity: DriverCard['severity']): string {
  if (severity === 'good') return '#3CC8A9';
  if (severity === 'watch') return '#F59E0B';
  return '#EF4444';
}

function buildLabels(points: number): string[] {
  if (points <= 0) return [];
  const stride = Math.max(1, Math.ceil(points / 6));
  return Array.from({ length: points }, (_, index) => (index % stride === 0 || index === points - 1 ? `${index + 1}` : ''));
}

export default function WorkoutInsightsModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkoutInsightsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRep, setSelectedRep] = useState<number | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [scrubTrackWidth, setScrubTrackWidth] = useState<number>(0);
  const [isPlaybackActive, setIsPlaybackActive] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<0.75 | 1 | 1.5>(1);

  const load = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await fetchWorkoutInsightsSnapshot(params.sessionId);
      setSnapshot(data);
      setSelectedRep(null);
      setScrubIndex(null);
      setIsPlaybackActive(false);
      setError(data ? null : 'No workout insight data found for this session yet.');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load workout insights.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [params.sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const availableReps = useMemo(() => {
    if (!snapshot) return [] as number[];
    return [...new Set(snapshot.wavePoints.map((point) => point.repNumber).filter((rep): rep is number => typeof rep === 'number' && rep > 0))]
      .sort((a, b) => a - b);
  }, [snapshot]);

  const scopedWavePoints = useMemo(() => {
    if (!snapshot) return [];
    const points = selectedRep === null
      ? snapshot.wavePoints
      : snapshot.wavePoints.filter((point) => point.repNumber === selectedRep);
    return points.length > 2 ? points : snapshot.wavePoints;
  }, [selectedRep, snapshot]);

  const chartData = useMemo(() => {
    if (!snapshot || scopedWavePoints.length === 0) {
      return null;
    }

    return {
      labels: buildLabels(scopedWavePoints.length),
      datasets: [
        {
          data: scopedWavePoints.map((point) => point.left),
          color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
          strokeWidth: 2,
        },
        {
          data: scopedWavePoints.map((point) => point.right),
          color: (opacity = 1) => `rgba(60, 200, 169, ${opacity})`,
          strokeWidth: 2,
        },
      ],
      legend: ['Left', 'Right'],
    };
  }, [scopedWavePoints, snapshot]);

  useEffect(() => {
    setScrubIndex((previous) => {
      if (scopedWavePoints.length === 0) return null;
      if (previous === null || previous >= scopedWavePoints.length) {
        return scopedWavePoints.length - 1;
      }
      return previous;
    });
  }, [scopedWavePoints.length, selectedRep, snapshot?.sessionId]);

  const selectedWavePoint =
    scrubIndex !== null && scrubIndex >= 0 && scrubIndex < scopedWavePoints.length
      ? scopedWavePoints[scrubIndex]
      : null;

  const scrubRatio =
    scrubIndex !== null && scopedWavePoints.length > 1
      ? scrubIndex / Math.max(1, scopedWavePoints.length - 1)
      : 0;

  const scrubPx = scrubTrackWidth * scrubRatio;
  const playbackIntervalMs = Math.round(180 / playbackSpeed);

  const updateScrubFromX = React.useCallback(
    (locationX: number) => {
      if (scrubTrackWidth <= 0 || scopedWavePoints.length === 0) return;
      const ratio = Math.min(1, Math.max(0, locationX / scrubTrackWidth));
      const nextIndex = Math.round(ratio * Math.max(0, scopedWavePoints.length - 1));
      setScrubIndex(nextIndex);
    },
    [scopedWavePoints.length, scrubTrackWidth],
  );

  const handleScrubResponder = React.useCallback(
    (event: GestureResponderEvent) => {
      setIsPlaybackActive(false);
      updateScrubFromX(event.nativeEvent.locationX);
    },
    [updateScrubFromX],
  );

  const handleScrubTrackLayout = React.useCallback((event: LayoutChangeEvent) => {
    setScrubTrackWidth(event.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    if (!isPlaybackActive || scopedWavePoints.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      setScrubIndex((previous) => {
        if (previous === null) return 0;
        return Math.min(previous + 1, scopedWavePoints.length - 1);
      });
    }, playbackIntervalMs);

    return () => clearInterval(timer);
  }, [isPlaybackActive, playbackIntervalMs, scopedWavePoints.length]);

  useEffect(() => {
    if (!isPlaybackActive || scrubIndex === null || scopedWavePoints.length === 0) return;
    if (scrubIndex >= scopedWavePoints.length - 1) {
      setIsPlaybackActive(false);
    }
  }, [isPlaybackActive, scrubIndex, scopedWavePoints.length]);

  const togglePlayback = React.useCallback(() => {
    if (scopedWavePoints.length === 0) return;

    setIsPlaybackActive((current) => {
      const next = !current;
      if (next && scrubIndex !== null && scrubIndex >= scopedWavePoints.length - 1) {
        setScrubIndex(0);
      }
      return next;
    });
  }, [scopedWavePoints.length, scrubIndex]);

  const restartPlayback = React.useCallback(() => {
    if (scopedWavePoints.length === 0) return;
    setScrubIndex(0);
    setIsPlaybackActive(true);
  }, [scopedWavePoints.length]);

  const phaseSegments = useMemo(() => {
    if (scopedWavePoints.length === 0) return [] as { phase: string; count: number; ratio: number }[];

    const counts = new Map<string, number>();
    scopedWavePoints.forEach((point) => {
      const phase = point.phase ?? 'unknown';
      counts.set(phase, (counts.get(phase) ?? 0) + 1);
    });

    const total = scopedWavePoints.length;
    return [...counts.entries()].map(([phase, count]) => ({
      phase,
      count,
      ratio: count / total,
    }));
  }, [scopedWavePoints]);

  const fatigueTrendData = useMemo(() => {
    if (!snapshot || snapshot.fatigueTrend.length === 0) return null;
    const points = snapshot.fatigueTrend;
    const stride = Math.max(1, Math.ceil(points.length / 4));

    return {
      labels: points.map((point, index) => (index % stride === 0 || index === points.length - 1 ? point.label : '')),
      datasets: [
        {
          data: points.map((point) => point.score),
          color: (opacity = 1) => `rgba(245, 247, 255, ${opacity})`,
          strokeWidth: 2,
        },
      ],
      trendDelta:
        points.length >= 2
          ? Number((points[points.length - 1].score - points[0].score).toFixed(1))
          : null,
    };
  }, [snapshot]);

  const phaseColor = (phase: string): string => {
    const p = phase.toLowerCase();
    if (p.includes('pull') || p.includes('up')) return '#4C8CFF';
    if (p.includes('down') || p.includes('eccentric')) return '#3CC8A9';
    if (p.includes('top') || p.includes('lockout')) return '#F59E0B';
    if (p.includes('hang') || p.includes('bottom')) return '#7C8FB0';
    return '#6781A6';
  };

  const fatigueColor =
    snapshot?.fatigueLevel === 'high' ? '#EF4444' : snapshot?.fatigueLevel === 'moderate' ? '#F59E0B' : '#3CC8A9';

  const fatigueConfidenceColor =
    snapshot?.fatigueConfidence.level === 'high'
      ? '#3CC8A9'
      : snapshot?.fatigueConfidence.level === 'medium'
        ? '#4C8CFF'
        : snapshot?.fatigueConfidence.level === 'low'
          ? '#F59E0B'
          : '#7C8FB0';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Workout Insights</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.stateText}>Building your biomechanics summary...</Text>
        </View>
      ) : error || !snapshot ? (
        <View style={styles.centerState}>
          <Ionicons name="analytics-outline" size={42} color="#6781A6" />
          <Text style={styles.stateTitle}>No insight data yet</Text>
          <Text style={styles.stateText}>{error ?? 'Record and complete a set to unlock analytics.'}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#4C8CFF" />}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Reps</Text>
              <Text style={styles.summaryValue}>{snapshot.repsCompleted}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Avg FQI</Text>
              <Text style={styles.summaryValue}>{snapshot.avgFqi ?? '--'}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Balance</Text>
              <Text style={styles.summaryValue}>{snapshot.asymmetryScore}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Waveform - {snapshot.waveLabel}</Text>
            <Text style={styles.cardSubtitle}>Left vs right movement from your camera perspective.</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.repScrubberRow}>
              <TouchableOpacity
                style={[styles.repChip, selectedRep === null && styles.repChipActive]}
                onPress={() => {
                  setSelectedRep(null);
                  setIsPlaybackActive(false);
                }}
              >
                <Text style={[styles.repChipText, selectedRep === null && styles.repChipTextActive]}>All reps</Text>
              </TouchableOpacity>
              {availableReps.map((rep) => (
                <TouchableOpacity
                  key={rep}
                  style={[styles.repChip, selectedRep === rep && styles.repChipActive]}
                  onPress={() => {
                    setSelectedRep(rep);
                    setIsPlaybackActive(false);
                  }}
                >
                  <Text style={[styles.repChipText, selectedRep === rep && styles.repChipTextActive]}>Rep {rep}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.playbackRow}>
              <TouchableOpacity style={styles.playbackButton} onPress={togglePlayback}>
                <Ionicons name={isPlaybackActive ? 'pause' : 'play'} size={16} color="#F5F7FF" />
                <Text style={styles.playbackButtonText}>
                  {isPlaybackActive ? 'Pause' : scrubIndex !== null && scrubIndex >= scopedWavePoints.length - 1 ? 'Replay' : 'Play rep'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.playbackButtonGhost} onPress={restartPlayback}>
                <Ionicons name="play-skip-back" size={15} color="#9AACD1" />
                <Text style={styles.playbackButtonGhostText}>Restart</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.playbackSpeedRow}>
              {[0.75, 1, 1.5].map((speed) => (
                <TouchableOpacity
                  key={speed}
                  style={[styles.playbackSpeedChip, playbackSpeed === speed && styles.playbackSpeedChipActive]}
                  onPress={() => setPlaybackSpeed(speed as 0.75 | 1 | 1.5)}
                >
                  <Text
                    style={[
                      styles.playbackSpeedChipText,
                      playbackSpeed === speed && styles.playbackSpeedChipTextActive,
                    ]}
                  >
                    {speed}x
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.playbackFrameHint}>
                Point {scrubIndex === null ? '--' : scrubIndex + 1}/{scopedWavePoints.length}
              </Text>
            </View>

            {chartData && (
              <LineChart
                data={chartData}
                width={chartWidth}
                height={chartHeight}
                chartConfig={{
                  backgroundColor: 'transparent',
                  backgroundGradientFrom: '#0F2339',
                  backgroundGradientTo: '#1B2E4A',
                  decimalPlaces: 0,
                  color: (opacity = 1) => `rgba(245, 247, 255, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
                  propsForBackgroundLines: {
                    stroke: 'rgba(154, 172, 209, 0.15)',
                    strokeWidth: 1,
                  },
                  propsForDots: {
                    r: '0',
                  },
                }}
                withDots={false}
                withInnerLines
                withOuterLines={false}
                withVerticalLines={false}
                bezier
                style={styles.chart}
              />
            )}

            <View style={styles.phaseBandTrack}>
              {phaseSegments.map((segment) => (
                <View
                  key={segment.phase}
                  style={[
                    styles.phaseBandSegment,
                    {
                      flex: Math.max(0.05, segment.ratio),
                      backgroundColor: phaseColor(segment.phase),
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.phaseLegendWrap}>
              {phaseSegments.map((segment) => (
                <View key={`${segment.phase}-legend`} style={styles.phaseLegendItem}>
                  <View style={[styles.phaseLegendDot, { backgroundColor: phaseColor(segment.phase) }]} />
                  <Text style={styles.phaseLegendText}>{segment.phase}</Text>
                </View>
              ))}
            </View>

            <View
              style={styles.scrubTrack}
              onLayout={handleScrubTrackLayout}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={handleScrubResponder}
              onResponderMove={handleScrubResponder}
            >
              <View style={[styles.scrubProgress, { width: scrubPx }]} />
              <View style={[styles.scrubHandle, { left: Math.max(0, scrubPx - 7) }]} />
            </View>

            {selectedWavePoint && (
              <View style={styles.scrubReadoutRow}>
                <View style={styles.scrubReadoutPill}>
                  <Text style={styles.scrubReadoutLabel}>Rep</Text>
                  <Text style={styles.scrubReadoutValue}>{selectedWavePoint.repNumber ?? '--'}</Text>
                </View>
                <View style={styles.scrubReadoutPill}>
                  <Text style={styles.scrubReadoutLabel}>Phase</Text>
                  <Text style={styles.scrubReadoutValue}>{selectedWavePoint.phase ?? 'unknown'}</Text>
                </View>
                <View style={styles.scrubReadoutPill}>
                  <Text style={styles.scrubReadoutLabel}>L/R</Text>
                  <Text style={styles.scrubReadoutValue}>
                    {selectedWavePoint.left.toFixed(1)} / {selectedWavePoint.right.toFixed(1)}
                  </Text>
                </View>
                <View style={styles.scrubReadoutPill}>
                  <Text style={styles.scrubReadoutLabel}>Delta</Text>
                  <Text style={styles.scrubReadoutValue}>
                    {Math.abs(selectedWavePoint.left - selectedWavePoint.right).toFixed(1)} deg
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Training Fatigue</Text>
            <Text style={styles.cardSubtitle}>Interpretable fatigue estimate from form decay + heart-rate strain.</Text>
            <View style={styles.fatigueHeaderRow}>
              <Text style={styles.fatigueLabel}>Fatigue score</Text>
              <Text style={[styles.fatigueValue, { color: fatigueColor }]}>{snapshot.fatigueScore ?? '--'}</Text>
            </View>
            <View style={styles.fatigueConfidenceRow}>
              <Text style={styles.fatigueConfidenceLabel}>Confidence</Text>
              <View style={[styles.fatigueConfidenceBadge, { borderColor: fatigueConfidenceColor }]}> 
                <View style={[styles.fatigueConfidenceDot, { backgroundColor: fatigueConfidenceColor }]} />
                <Text style={[styles.fatigueConfidenceText, { color: fatigueConfidenceColor }]}>
                  {snapshot.fatigueConfidence.level}
                  {snapshot.fatigueConfidence.score !== null ? ` (${snapshot.fatigueConfidence.score})` : ''}
                </Text>
              </View>
            </View>
            {(snapshot.fatigueConfidence.level === 'low' || snapshot.fatigueConfidence.level === 'insufficient') && (
              <Text style={styles.fatigueConfidenceNote}>{snapshot.fatigueConfidence.note}</Text>
            )}
            <View style={styles.metricsGrid}>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>FQI drop</Text>
                <Text style={styles.metricValue}>
                  {snapshot.fatigueSignals.fqiDropPct === null ? '--' : `${snapshot.fatigueSignals.fqiDropPct.toFixed(1)}%`}
                </Text>
              </View>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>Tempo drift</Text>
                <Text style={styles.metricValue}>
                  {snapshot.fatigueSignals.tempoDriftPct === null ? '--' : `${snapshot.fatigueSignals.tempoDriftPct.toFixed(1)}%`}
                </Text>
              </View>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>Asymmetry drift</Text>
                <Text style={styles.metricValue}>
                  {snapshot.fatigueSignals.asymmetryDriftDeg === null ? '--' : `${snapshot.fatigueSignals.asymmetryDriftDeg.toFixed(1)} deg`}
                </Text>
              </View>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>HR strain</Text>
                <Text style={styles.metricValue}>
                  {snapshot.fatigueSignals.heartRateStrainBpm === null ? '--' : `${snapshot.fatigueSignals.heartRateStrainBpm.toFixed(1)} bpm`}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.fatigueTrendHeader}>
              <Text style={styles.cardTitle}>Fatigue Trend</Text>
              {fatigueTrendData?.trendDelta !== null && fatigueTrendData?.trendDelta !== undefined && (
                <Text
                  style={[
                    styles.fatigueTrendDelta,
                    fatigueTrendData.trendDelta > 0 ? styles.fatigueTrendUp : styles.fatigueTrendDown,
                  ]}
                >
                  {fatigueTrendData.trendDelta > 0 ? '+' : ''}
                  {fatigueTrendData.trendDelta.toFixed(1)}
                </Text>
              )}
            </View>
            <Text style={styles.cardSubtitle}>Last sessions fatigue trajectory.</Text>

            {fatigueTrendData ? (
              <LineChart
                data={{ labels: fatigueTrendData.labels, datasets: fatigueTrendData.datasets }}
                width={chartWidth}
                height={140}
                chartConfig={{
                  backgroundColor: 'transparent',
                  backgroundGradientFrom: '#0F2339',
                  backgroundGradientTo: '#1B2E4A',
                  decimalPlaces: 0,
                  color: (opacity = 1) => `rgba(245, 247, 255, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
                  propsForBackgroundLines: {
                    stroke: 'rgba(154, 172, 209, 0.15)',
                    strokeWidth: 1,
                  },
                  propsForDots: {
                    r: '2',
                    strokeWidth: '0',
                  },
                }}
                withDots
                withInnerLines
                withOuterLines={false}
                withVerticalLines={false}
                withHorizontalLabels
                fromZero
                style={styles.trendChart}
              />
            ) : (
              <Text style={styles.emptyInlineText}>Not enough historical sessions yet.</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coach Actions</Text>
            <Text style={styles.cardSubtitle}>Auto-adjustments based on fatigue and movement drift.</Text>
            {snapshot.coachActions.map((action) => (
              <View key={action.id} style={styles.actionRow}>
                <View
                  style={[
                    styles.actionPriority,
                    action.priority === 'high'
                      ? styles.actionPriorityHigh
                      : action.priority === 'medium'
                        ? styles.actionPriorityMedium
                        : styles.actionPriorityLow,
                  ]}
                />
                <View style={styles.actionBody}>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                  <Text style={styles.actionDetail}>{action.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Asymmetry Analytics</Text>
            <View style={styles.metricsGrid}>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>Mean gap</Text>
                <Text style={styles.metricValue}>{snapshot.meanAsymmetryDeg.toFixed(1)} deg</Text>
              </View>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>P95 gap</Text>
                <Text style={styles.metricValue}>{snapshot.p95AsymmetryDeg.toFixed(1)} deg</Text>
              </View>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>Max gap</Text>
                <Text style={styles.metricValue}>{snapshot.maxAsymmetryDeg.toFixed(1)} deg</Text>
              </View>
              <View style={styles.metricPill}>
                <Text style={styles.metricLabel}>Avg rep tempo</Text>
                <Text style={styles.metricValue}>
                  {snapshot.avgRepDurationMs ? `${Math.round(snapshot.avgRepDurationMs / 10) / 100}s` : '--'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Biomechanics Drivers</Text>
            {snapshot.drivers.map((driver) => (
              <View key={driver.id} style={styles.driverRow}>
                <View style={[styles.driverDot, { backgroundColor: severityColor(driver.severity) }]} />
                <View style={styles.driverBody}>
                  <View style={styles.driverTopRow}>
                    <Text style={styles.driverTitle}>{driver.title}</Text>
                    <Text style={styles.driverValue}>{driver.value}</Text>
                  </View>
                  <Text style={styles.driverDetail}>{driver.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1626',
  },
  header: {
    paddingTop: 58,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(154, 172, 209, 0.18)',
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 19,
    fontWeight: '700',
    color: '#F5F7FF',
    marginRight: 34,
  },
  headerSpacer: {
    width: 0,
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  stateTitle: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
  },
  stateText: {
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 20,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#12243A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#9AACD1',
    fontSize: 12,
  },
  summaryValue: {
    color: '#F5F7FF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#12243A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    padding: 14,
  },
  cardTitle: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#9AACD1',
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12,
  },
  chart: {
    borderRadius: 12,
    marginLeft: -10,
  },
  repScrubberRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 10,
  },
  repChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
    backgroundColor: '#0F2339',
  },
  repChipActive: {
    backgroundColor: '#4C8CFF',
    borderColor: '#4C8CFF',
  },
  repChipText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
  },
  repChipTextActive: {
    color: '#F5F7FF',
  },
  playbackRow: {
    marginTop: 2,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  playbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4C8CFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  playbackButtonText: {
    color: '#F5F7FF',
    fontSize: 12,
    fontWeight: '700',
  },
  playbackButtonGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F2339',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
  },
  playbackButtonGhostText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
  },
  playbackSpeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  playbackSpeedChip: {
    backgroundColor: '#0F2339',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  playbackSpeedChipActive: {
    backgroundColor: '#4C8CFF',
    borderColor: '#4C8CFF',
  },
  playbackSpeedChipText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
  },
  playbackSpeedChipTextActive: {
    color: '#F5F7FF',
  },
  playbackFrameHint: {
    marginLeft: 'auto',
    color: '#9AACD1',
    fontSize: 11,
  },
  phaseBandTrack: {
    marginTop: 8,
    height: 10,
    borderRadius: 6,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.15)',
  },
  phaseBandSegment: {
    height: '100%',
  },
  phaseLegendWrap: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  phaseLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  phaseLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  phaseLegendText: {
    color: '#9AACD1',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  scrubTrack: {
    marginTop: 12,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0F2339',
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  scrubProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(76, 140, 255, 0.35)',
  },
  scrubHandle: {
    position: 'absolute',
    top: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4C8CFF',
    borderWidth: 1,
    borderColor: '#F5F7FF',
  },
  scrubReadoutRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scrubReadoutPill: {
    minWidth: '47%',
    backgroundColor: '#0F2339',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scrubReadoutLabel: {
    color: '#9AACD1',
    fontSize: 11,
  },
  scrubReadoutValue: {
    color: '#F5F7FF',
    fontWeight: '600',
    marginTop: 3,
    textTransform: 'capitalize',
  },
  fatigueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fatigueLabel: {
    color: '#9AACD1',
    fontSize: 13,
    fontWeight: '600',
  },
  fatigueConfidenceRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fatigueConfidenceLabel: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
  },
  fatigueConfidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 11,
    borderWidth: 1,
    backgroundColor: '#0F2339',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  fatigueConfidenceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  fatigueConfidenceText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  fatigueConfidenceNote: {
    marginTop: 8,
    color: '#9AACD1',
    fontSize: 12,
    lineHeight: 17,
  },
  fatigueValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  fatigueTrendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fatigueTrendDelta: {
    fontSize: 14,
    fontWeight: '700',
  },
  fatigueTrendUp: {
    color: '#EF4444',
  },
  fatigueTrendDown: {
    color: '#3CC8A9',
  },
  trendChart: {
    borderRadius: 12,
    marginLeft: -10,
    marginTop: 2,
  },
  emptyInlineText: {
    color: '#9AACD1',
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metricPill: {
    minWidth: '47%',
    backgroundColor: '#0F2339',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  metricLabel: {
    color: '#9AACD1',
    fontSize: 11,
  },
  metricValue: {
    color: '#F5F7FF',
    fontWeight: '600',
    marginTop: 3,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
  },
  driverDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  driverBody: {
    flex: 1,
  },
  driverTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  driverTitle: {
    color: '#F5F7FF',
    fontWeight: '600',
  },
  driverValue: {
    color: '#DCE5F5',
    fontWeight: '700',
  },
  driverDetail: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 10,
  },
  actionPriority: {
    width: 8,
    height: 28,
    borderRadius: 4,
    marginTop: 2,
  },
  actionPriorityHigh: {
    backgroundColor: '#EF4444',
  },
  actionPriorityMedium: {
    backgroundColor: '#F59E0B',
  },
  actionPriorityLow: {
    backgroundColor: '#3CC8A9',
  },
  actionBody: {
    flex: 1,
  },
  actionTitle: {
    color: '#F5F7FF',
    fontWeight: '600',
  },
  actionDetail: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
});

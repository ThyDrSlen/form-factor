import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { WeightTrendChart } from '@/components/weight-dashboard/WeightTrendChart';
import { useHealthKit } from '@/contexts/HealthKitContext';
import { useWorkouts } from '@/contexts/WorkoutsContext';
import { useFood } from '@/contexts/FoodContext';
import { useAuth } from '@/contexts/AuthContext';
import { 
  fetchHealthTrendData, 
  getComparisonMetrics,
  type HealthTrendData,
  type AggregatedHealthMetrics 
} from '@/lib/services/healthkit/health-aggregation';

type TimeRange = 'daily' | 'weekly' | 'monthly';

interface MetricCardProps {
  title: string;
  value: string;
  change?: string;
  icon: string;
  color: string;
  onPress?: () => void;
}

function MetricCard({ title, value, change, icon, color, onPress }: MetricCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.metricCard}>
      <LinearGradient
        colors={[`${color}15`, `${color}05`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.metricGradient}
      >
        <View style={styles.metricIconContainer}>
          <Ionicons name={icon as any} size={24} color={color} />
        </View>
        <Text style={styles.metricValue}>{value}</Text>
        <Text style={styles.metricTitle}>{title}</Text>
        {change && (
          <Text style={[styles.metricChange, { color: change.startsWith('+') ? '#34C759' : change.startsWith('-') ? '#FF3B30' : '#9AACD1' }]}>
            {change}
          </Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

function TimeRangeSelector({ 
  selectedRange, 
  onRangeChange 
}: { 
  selectedRange: TimeRange; 
  onRangeChange: (range: TimeRange) => void;
}) {
  return (
    <View style={styles.timeRangeContainer}>
      {(['daily', 'weekly', 'monthly'] as TimeRange[]).map((range) => (
        <TouchableOpacity
          key={range}
          onPress={() => onRangeChange(range)}
          style={[styles.timeRangeButton, selectedRange === range && styles.timeRangeButtonActive]}
        >
          <Text style={[styles.timeRangeText, selectedRange === range && styles.timeRangeTextActive]}>
            {range.charAt(0).toUpperCase() + range.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SyncProgressBanner({ 
  syncProgress, 
  isSyncing 
}: { 
  syncProgress: any; 
  isSyncing: boolean;
}) {
  if (!isSyncing && !syncProgress) return null;

  const getPhaseMessage = () => {
    if (!syncProgress) return 'Syncing...';
    
    switch (syncProgress.phase) {
      case 'fetching':
        return 'Fetching data from HealthKit...';
      case 'uploading':
        return `Uploading ${syncProgress.current}/${syncProgress.total} records...`;
      case 'complete':
        return '✓ Sync complete!';
      case 'error':
        return '✗ Sync failed';
      default:
        return 'Syncing...';
    }
  };

  const progress = syncProgress?.total > 0 
    ? (syncProgress.current / syncProgress.total) * 100 
    : 0;

  return (
    <View style={styles.syncBanner}>
      <View style={styles.syncBannerContent}>
        <ActivityIndicator size="small" color="#4C8CFF" />
        <View style={styles.syncBannerText}>
          <Text style={styles.syncBannerTitle}>{getPhaseMessage()}</Text>
          {syncProgress?.total > 0 && (
            <Text style={styles.syncBannerSubtitle}>
              {Math.round(progress)}% complete
            </Text>
          )}
        </View>
      </View>
      {syncProgress?.total > 0 && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      )}
    </View>
  );
}

export function HealthTrendsView() {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('weekly');
  const [trendData, setTrendData] = useState<HealthTrendData | null>(null);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  
  const { 
    stepsToday, 
    latestHeartRate, 
    bodyMassKg, 
    weightHistory,
    weightHistory30Days,
    weightHistory90Days,
    isSyncing,
    syncProgress,
    hasSyncedBefore,
    syncAllHistoricalData,
    checkDataRange
  } = useHealthKit();
  const { workouts } = useWorkouts();
  const { foods } = useFood();
  const { user } = useAuth();

  // Load aggregated trend data
  useEffect(() => {
    if (!user?.id) return;

    const loadTrendData = async () => {
      setIsLoadingTrends(true);
      try {
        const days = selectedRange === 'daily' ? 7 : selectedRange === 'weekly' ? 90 : 180;
        const data = await fetchHealthTrendData(user.id, days);
        setTrendData(data);
      } catch (error) {
        console.error('[HealthTrends] Failed to load trend data', error);
      } finally {
        setIsLoadingTrends(false);
      }
    };

    loadTrendData();
  }, [user?.id, selectedRange, hasSyncedBefore]);

  // Handle initial sync prompt
  const handleInitialSync = async () => {
    if (!user?.id) return;

    const range = await checkDataRange();
    
    if (range.count === 0) {
      Alert.alert(
        'Sync HealthKit Data',
        'Would you like to import your historical health data? This will sync up to 1 year of steps and weight data to enable trends analysis.',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Sync Now',
            onPress: () => syncAllHistoricalData(365),
          },
        ]
      );
    } else if (range.count < 30) {
      // Has some data but not much
      Alert.alert(
        'Sync More Data',
        `You have ${range.count} days of synced data. Sync more to see better trends?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sync 1 Year',
            onPress: () => syncAllHistoricalData(365),
          },
        ]
      );
    }
  };

  // Get metrics based on selected range
  const getCurrentMetrics = () => {
    if (!trendData) {
      return {
        steps: stepsToday || 0,
        avgSteps: 0,
        workouts: 0,
        calories: 0,
        heartRate: latestHeartRate?.bpm || 0,
        weight: bodyMassKg?.kg || 0,
      };
    }

    const now = new Date();
    let aggregated: AggregatedHealthMetrics | null = null;

    if (selectedRange === 'daily') {
      const today = now.toISOString().slice(0, 10);
      const todayData = trendData.daily.find(d => d.date === today);
      return {
        steps: todayData?.steps || stepsToday || 0,
        avgSteps: 0,
        workouts: workouts.filter(w => 
          new Date(w.date).toDateString() === now.toDateString()
        ).length,
        calories: foods.filter(f => 
          new Date(f.date).toDateString() === now.toDateString()
        ).reduce((sum, f) => sum + (f.calories || 0), 0),
        heartRate: todayData?.heartRateBpm || latestHeartRate?.bpm || 0,
        weight: todayData?.weightKg || bodyMassKg?.kg || 0,
      };
    } else if (selectedRange === 'weekly') {
      const comparison = getComparisonMetrics(trendData.weekly, 'weekly');
      aggregated = comparison.current;
    } else {
      const comparison = getComparisonMetrics(trendData.monthly, 'monthly');
      aggregated = comparison.current;
    }

    if (!aggregated) {
      return {
        steps: 0,
        avgSteps: 0,
        workouts: 0,
        calories: 0,
        heartRate: 0,
        weight: 0,
      };
    }

    // Calculate workouts and calories for the period
    const periodStart = new Date(aggregated.period);
    const periodEnd = new Date(periodStart);
    if (selectedRange === 'weekly') {
      periodEnd.setDate(periodEnd.getDate() + 7);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    return {
      steps: aggregated.totalSteps || 0,
      avgSteps: aggregated.avgSteps || 0,
      workouts: workouts.filter(w => {
        const wDate = new Date(w.date);
        return wDate >= periodStart && wDate < periodEnd;
      }).length,
      calories: foods.filter(f => {
        const fDate = new Date(f.date);
        return fDate >= periodStart && fDate < periodEnd;
      }).reduce((sum, f) => sum + (f.calories || 0), 0),
      heartRate: aggregated.avgHeartRate || latestHeartRate?.bpm || 0,
      weight: aggregated.avgWeight || bodyMassKg?.kg || 0,
    };
  };

  // Get comparison metrics
  const getChangePercentage = () => {
    if (!trendData) return null;

    if (selectedRange === 'weekly') {
      return getComparisonMetrics(trendData.weekly, 'weekly');
    } else if (selectedRange === 'monthly') {
      return getComparisonMetrics(trendData.monthly, 'monthly');
    }
    return null;
  };

  const currentMetrics = getCurrentMetrics();
  const comparison = getChangePercentage();

  // Weight series for chart based on selected range
  const weightPeriod = selectedRange === 'daily' ? '7d' : selectedRange === 'weekly' ? '30d' : '90d';
  const weightSeries = weightPeriod === '7d' ? weightHistory : weightPeriod === '30d' ? weightHistory30Days : weightPeriod === '90d' ? weightHistory90Days : weightHistory;

  const formatChange = (change: number | null): string | undefined => {
    if (change == null) return undefined;
    return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  };

  return (
    <View style={styles.container}>
      {/* Sync Progress Banner */}
      <SyncProgressBanner syncProgress={syncProgress} isSyncing={isSyncing} />

      {/* Sync Button (if no data) */}
      {!hasSyncedBefore && !isSyncing && (
        <TouchableOpacity style={styles.syncButton} onPress={handleInitialSync}>
          <Ionicons name="cloud-upload-outline" size={20} color="#4C8CFF" />
          <Text style={styles.syncButtonText}>Sync HealthKit Data</Text>
        </TouchableOpacity>
      )}

      {/* Time Range Selector */}
      <TimeRangeSelector selectedRange={selectedRange} onRangeChange={setSelectedRange} />

      {/* Weight Trend Chart */}
      <WeightTrendChart data={weightSeries} period={weightPeriod} weightUnit="kg" />

      {isLoadingTrends ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4C8CFF" />
          <Text style={styles.loadingText}>Loading trends...</Text>
        </View>
      ) : (
        <>
          {/* Metrics Grid */}
          <View style={styles.metricsGrid}>
            <MetricCard
              title={selectedRange === 'daily' ? 'Steps' : 'Avg Steps/Day'}
              value={(selectedRange === 'daily' ? currentMetrics.steps : currentMetrics.avgSteps).toLocaleString()}
              change={selectedRange !== 'daily' ? formatChange(comparison?.stepsChange ?? null) : undefined}
              icon="footsteps-outline"
              color="#4C8CFF"
            />

            <MetricCard
              title="Workouts"
              value={currentMetrics.workouts.toString()}
              icon="fitness-outline"
              color="#FF6B6B"
            />

            <MetricCard
              title="Calories"
              value={currentMetrics.calories.toString()}
              icon="flame-outline"
              color="#FFCC00"
            />

            <MetricCard
              title={selectedRange === 'daily' ? 'Heart Rate' : 'Avg Heart Rate'}
              value={currentMetrics.heartRate ? `${Math.round(currentMetrics.heartRate)} bpm` : '—'}
              change={selectedRange !== 'daily' ? formatChange(comparison?.heartRateChange ?? null) : undefined}
              icon="heart-outline"
              color="#34C759"
            />

            <MetricCard
              title={selectedRange === 'daily' ? 'Weight' : 'Avg Weight'}
              value={currentMetrics.weight ? `${currentMetrics.weight.toFixed(1)} kg` : '—'}
              change={selectedRange !== 'daily' ? formatChange(comparison?.weightChange ?? null) : undefined}
              icon="scale-outline"
              color="#9D4EDD"
            />
          </View>

          {/* Data Info */}
          {trendData && (
            <View style={styles.dataInfo}>
              <Ionicons name="information-circle-outline" size={16} color="#9AACD1" />
              <Text style={styles.dataInfoText}>
                {selectedRange === 'daily' 
                  ? `Showing today's data` 
                  : selectedRange === 'weekly'
                  ? `${trendData.weekly.length} weeks of data available`
                  : `${trendData.monthly.length} months of data available`
                }
              </Text>
            </View>
          )}

          {/* Quick Insights */}
          <View style={styles.insightsSection}>
            <Text style={styles.sectionTitle}>Quick Insights</Text>
            <View style={styles.insightsContainer}>
              {comparison?.stepsChange != null && (
                <View style={styles.insightCard}>
                  <Ionicons 
                    name={comparison.stepsChange >= 0 ? "trending-up" : "trending-down"} 
                    size={20} 
                    color={comparison.stepsChange >= 0 ? "#34C759" : "#FF3B30"} 
                  />
                  <Text style={styles.insightText}>
                    Steps {comparison.stepsChange >= 0 ? 'up' : 'down'} {Math.abs(comparison.stepsChange).toFixed(1)}% vs previous period
                  </Text>
                </View>
              )}
              
              {currentMetrics.workouts > 0 && (
                <View style={styles.insightCard}>
                  <Ionicons name="checkmark-circle" size={20} color="#4C8CFF" />
                  <Text style={styles.insightText}>
                    {currentMetrics.workouts} workout{currentMetrics.workouts > 1 ? 's' : ''} completed
                  </Text>
                </View>
              )}
              
              {comparison?.weightChange != null && Math.abs(comparison.weightChange) > 1 && (
                <View style={styles.insightCard}>
                  <Ionicons name="pulse" size={20} color="#9D4EDD" />
                  <Text style={styles.insightText}>
                    Weight {comparison.weightChange >= 0 ? 'increased' : 'decreased'} {Math.abs(comparison.weightChange).toFixed(1)}%
                  </Text>
                </View>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  syncBanner: {
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.3)',
  },
  syncBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  syncBannerText: {
    flex: 1,
  },
  syncBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  syncBannerSubtitle: {
    fontSize: 12,
    color: '#9AACD1',
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4C8CFF',
    borderRadius: 2,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.3)',
  },
  syncButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4C8CFF',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9AACD1',
  },
  timeRangeContainer: {
    flexDirection: 'row',
    backgroundColor: '#0F2339',
    borderRadius: 16,
    padding: 4,
    marginBottom: 24,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  timeRangeButtonActive: {
    backgroundColor: '#4C8CFF',
  },
  timeRangeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9AACD1',
  },
  timeRangeTextActive: {
    color: '#FFFFFF',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
  },
  metricGradient: {
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  metricIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  metricTitle: {
    fontSize: 14,
    color: '#9AACD1',
    marginBottom: 4,
    textAlign: 'center',
  },
  metricChange: {
    fontSize: 12,
    fontWeight: '600',
  },
  dataInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(15, 35, 57, 0.5)',
    borderRadius: 12,
    marginBottom: 24,
  },
  dataInfoText: {
    fontSize: 13,
    color: '#9AACD1',
    flex: 1,
  },
  insightsSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
  },
  insightsContainer: {
    gap: 12,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F2339',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  insightText: {
    fontSize: 16,
    color: '#F5F7FF',
    marginLeft: 12,
    flex: 1,
  },
});

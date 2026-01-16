/**
 * Weight Trend Chart with react-native-chart-kit
 * Simple, reliable charting for React Native
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { logWithTs } from '@/lib/logger';
import type { HealthMetricPoint } from '../../lib/services/healthkit/health-metrics';

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - 40;
const chartHeight = 220;

interface WeightTrendChartProps {
  data: HealthMetricPoint[];
  period: '7d' | '30d' | '90d' | '180d';
  weightUnit: string;
  showPredictions?: boolean;
}

export function WeightTrendChart({
  data,
  period,
  weightUnit,
  showPredictions = false,
}: WeightTrendChartProps) {
  
  // Debug logging
  logWithTs('WeightTrendChart.chartkit - Data received:', {
    dataLength: data.length,
    period,
    weightUnit,
    showPredictions,
    firstDataPoint: data[0],
    lastDataPoint: data[data.length - 1]
  });

  // Memoize all derived values unconditionally to satisfy hooks rules
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => a.date - b.date);
  }, [data]);

  const labels = useMemo(() => {
    return sortedData.map((point) => {
      const d = new Date(point.date);
      switch (period) {
        case '7d':
          return d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
        case '30d':
          return d.toLocaleDateString('en-US', { day: 'numeric' });
        case '90d':
        case '180d':
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        default:
          return '';
      }
    });
  }, [sortedData, period]);

  const displayLabels = useMemo(() => {
    if (sortedData.length === 0) return [];
    const labelFrequency = Math.max(1, Math.ceil(sortedData.length / 5));
    return labels.map((label, index) =>
      index % labelFrequency === 0 || index === labels.length - 1 ? label : ''
    );
  }, [labels, sortedData.length]);

  const values = useMemo(() => sortedData.map((point) => point.value), [sortedData]);

  const chartData = useMemo(() => {
    return {
      labels: displayLabels,
      datasets: [
        {
          data: values,
          color: (opacity = 1) => `rgba(60, 200, 169, ${opacity})`,
          strokeWidth: 3,
        },
      ],
    };
  }, [displayLabels, values]);

  // Calculate statistics with proper validation
  const latestWeight = sortedData.length > 0 ? sortedData[sortedData.length - 1]?.value ?? 0 : 0;
  const firstWeight = sortedData.length > 0 ? sortedData[0]?.value ?? 0 : 0;
  const weightChange = latestWeight - firstWeight;

  if (data.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <View style={styles.noDataContainer}>
          <Text style={styles.noDataText}>No weight data available</Text>
          <Text style={styles.noDataSubtext}>
            Connect HealthKit to start tracking your weight
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>Weight Trend</Text>
      
      <View style={styles.chartWrapper}>
        <LineChart
          data={chartData}
          width={chartWidth}
          height={chartHeight}
          chartConfig={{
            backgroundColor: 'transparent',
            backgroundGradientFrom: 'rgba(15, 35, 57, 0.8)',
            backgroundGradientTo: 'rgba(27, 46, 74, 0.8)',
            decimalPlaces: 1,
            color: (opacity = 1) => `rgba(60, 200, 169, ${opacity})`,
            labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
            style: {
              borderRadius: 16,
            },
            propsForDots: {
              r: '4',
              strokeWidth: '2',
              stroke: '#FFFFFF',
              fill: '#3CC8A9',
            },
            propsForBackgroundLines: {
              strokeDasharray: '',
              stroke: 'rgba(255, 255, 255, 0.1)',
              strokeWidth: 1,
            },
          }}
          bezier
          style={styles.chart}
          withInnerLines={true}
          withOuterLines={false}
          withVerticalLines={false}
          withHorizontalLines={true}
          withDots={true}
          withShadow={false}
          fromZero={false}
          segments={4}
        />
      </View>
      
      {/* Chart info */}
      <View style={styles.chartInfo}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <View style={[styles.colorIndicator, { backgroundColor: '#3CC8A9' }]} />
            <Text style={styles.infoLabel}>Weight</Text>
          </View>
          <View style={styles.infoItem}>
            <View style={[styles.colorIndicator, { backgroundColor: '#4C8CFF' }]} />
            <Text style={styles.infoLabel}>Trend</Text>
          </View>
        </View>
        
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {latestWeight.toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>Latest ({weightUnit})</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[
              styles.statValue,
              { color: weightChange >= 0 ? '#3CC8A9' : '#FF6B6B' }
            ]}>
              {weightChange >= 0 ? '+' : ''}{weightChange.toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>Change ({weightUnit})</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartContainer: {
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
  },
  chartWrapper: {
    marginBottom: 16,
    marginLeft: -20,
    marginRight: -20,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  noDataContainer: {
    height: chartHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 8,
  },
  noDataSubtext: {
    fontSize: 14,
    color: '#9AACD1',
    textAlign: 'center',
  },
  chartInfo: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 16,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 20,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  infoLabel: {
    fontSize: 14,
    color: '#9AACD1',
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#9AACD1',
  },
});


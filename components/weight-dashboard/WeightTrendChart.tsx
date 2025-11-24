/**
 * Advanced Weight Trend Chart Component
 * Interactive chart with trend lines, predictions, and annotations
 */

import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Svg, Line, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { HealthMetricPoint } from '../../lib/services/healthkit/health-metrics';

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - 48;
const chartHeight = 200;
const padding = { top: 20, right: 36, bottom: 40, left: 48 };
const LABEL_WIDTH = 48;

interface WeightTrendChartProps {
  data: HealthMetricPoint[];
  period: '7d' | '30d' | '90d';
  weightUnit: string;
  showPredictions?: boolean;
}

export function WeightTrendChart({ 
  data, 
  period, 
  weightUnit, 
  showPredictions = false 
}: WeightTrendChartProps) {
  const normalizedData = React.useMemo(() => {
    if (data.length === 0) return [] as HealthMetricPoint[];

    const buckets = new Map<string, { sum: number; count: number; latestDate: number }>();

    data.forEach((point) => {
      const dayKey = new Date(point.date).toISOString().slice(0, 10);
      const bucket = buckets.get(dayKey);
      if (bucket) {
        bucket.sum += point.value;
        bucket.count += 1;
        if (point.date > bucket.latestDate) {
          bucket.latestDate = point.date;
        }
      } else {
        buckets.set(dayKey, { sum: point.value, count: 1, latestDate: point.date });
      }
    });

    return Array.from(buckets.values())
      .map((bucket) => ({
        date: bucket.latestDate,
        value: bucket.sum / bucket.count,
      }))
      .sort((a, b) => a.date - b.date);
  }, [data]);

  const pointsToRender = React.useMemo(() => {
    const arr = normalizedData;
    const maxPoints = period === '7d' ? 7 : period === '30d' ? 10 : 12;
    if (arr.length <= maxPoints) {
      return arr;
    }

    const stride = Math.max(1, Math.floor(arr.length / maxPoints));
    const sampled: typeof arr = [];
    for (let i = 0; i < arr.length; i += stride) {
      sampled.push(arr[i]);
    }

    const lastPoint = arr[arr.length - 1];
    if (sampled[sampled.length - 1] !== lastPoint) {
      sampled.push(lastPoint);
    }

    return sampled;
  }, [normalizedData, period]);

  // Debug logging
  console.log('WeightTrendChart.svg - Data received:', {
    dataLength: normalizedData.length,
    period,
    weightUnit,
    showPredictions,
    firstDataPoint: normalizedData[0],
    lastDataPoint: normalizedData[normalizedData.length - 1]
  });
  
  if (normalizedData.length === 0) {
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

  // Sort data by date
  const sortedData = normalizedData;
  
  // Calculate chart dimensions
  const chartInnerWidth = chartWidth - padding.left - padding.right;
  const chartInnerHeight = chartHeight - padding.top - padding.bottom;
  
  // Find min/max values for scaling with proper validation
  const values = sortedData.map(d => d.value);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const defaultMax = weightUnit === 'lbs' ? 260 : 120;
  const buffer = Math.max(2, (maxValue - minValue) * 0.1);
  let domainMin = Math.floor((minValue - buffer) / 10) * 10;
  let domainMax = Math.ceil((maxValue + buffer) / 10) * 10;

  // If the data looks unrealistic (very low range), fall back to a reasonable weight band
  const looksTooSmall = domainMax < (weightUnit === 'lbs' ? 80 : 40);
  if (looksTooSmall) {
    domainMin = 0;
    domainMax = defaultMax;
  } else {
    domainMin = Math.max(0, domainMin);
    if (domainMax - domainMin < 20) {
      domainMax = domainMin + 20;
    }
  }

  const domainRange = domainMax - domainMin;

  // Helper functions for coordinate conversion with proper validation
  const getX = (index: number) => {
    if (sortedData.length <= 1) return padding.left + chartInnerWidth / 2;
    return padding.left + (index / (sortedData.length - 1)) * chartInnerWidth;
  };
  
  const getY = (value: number) => {
    if (domainRange === 0) return padding.top + chartInnerHeight / 2;
    return padding.top + chartInnerHeight - ((value - domainMin) / domainRange) * chartInnerHeight;
  };

  // Generate trend line path
  const trendPath = sortedData
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(point.value)}`)
    .join(' ');

  // Generate area path for gradient fill with proper validation
  const areaPath = sortedData.length > 0 
    ? `${trendPath} L ${getX(sortedData.length - 1)} ${padding.top + chartInnerHeight} L ${getX(0)} ${padding.top + chartInnerHeight} Z`
    : '';

  // Calculate trend line using linear regression with proper validation
  const getTrendLine = () => {
    if (sortedData.length < 2) return null;
    
    const n = sortedData.length;
    const sumX = sortedData.reduce((sum, _, i) => sum + i, 0);
    const sumY = sortedData.reduce((sum, point) => sum + point.value, 0);
    const sumXY = sortedData.reduce((sum, point, i) => sum + i * point.value, 0);
    const sumXX = sortedData.reduce((sum, _, i) => sum + i * i, 0);
    
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return null; // Avoid division by zero
    
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    
    const startY = intercept;
    const endY = slope * (n - 1) + intercept;
    
    return {
      startX: getX(0),
      startY: getY(startY),
      endX: getX(n - 1),
      endY: getY(endY),
    };
  };

  const trendLine = getTrendLine();

  // Format dates for x-axis labels
  const getDateLabel = (date: number) => {
    const d = new Date(date);
    switch (period) {
      case '7d':
        return d.toLocaleDateString('en-US', { weekday: 'short' });
      case '30d':
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case '90d':
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      default:
        return '';
    }
  };

  // Generate y-axis labels with proper validation
  const generateYLabels = () => {
    const numLabels = 5;
    const labels = [];
    for (let i = 0; i <= numLabels; i++) {
      const value = domainRange === 0 ? domainMin : domainMin + (domainRange * i) / numLabels;
      labels.push({
        value: value.toFixed(0),
        y: getY(value),
      });
    }
    return labels;
  };

  const yLabels = generateYLabels();

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>Weight Trend</Text>
      
      <View style={styles.chartWrapper}>
        <Svg width={chartWidth} height={chartHeight}>
          <Defs>
            <LinearGradient id="weightGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#3CC8A9" stopOpacity="0.3" />
              <Stop offset="100%" stopColor="#3CC8A9" stopOpacity="0.05" />
            </LinearGradient>
          </Defs>
          
          {/* Grid lines */}
          {yLabels.map((label, index) => (
            <Line
              key={index}
              x1={padding.left}
              y1={label.y}
              x2={chartWidth - padding.right}
              y2={label.y}
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth="1"
            />
          ))}
          
          {/* Area fill */}
          <Path
            d={areaPath}
            fill="url(#weightGradient)"
          />
          
          {/* Trend line */}
          <Path
            d={trendPath}
            stroke="#3CC8A9"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Trend line overlay */}
          {trendLine && (
            <Line
              x1={trendLine.startX}
              y1={trendLine.startY}
              x2={trendLine.endX}
              y2={trendLine.endY}
              stroke="#4C8CFF"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.8"
            />
          )}
          
          {/* Data points */}
          {pointsToRender.map((point) => {
            const originalIndex = sortedData.indexOf(point);
            return (
              <Circle
                key={point.date}
                cx={getX(originalIndex)}
                cy={getY(point.value)}
                r="4"
                fill="#3CC8A9"
                stroke="#FFFFFF"
                strokeWidth="2"
              />
            );
          })}
          
          {/* Latest point highlight */}
          {sortedData.length > 0 && (
            <Circle
              cx={getX(sortedData.length - 1)}
              cy={getY(sortedData[sortedData.length - 1].value)}
              r="6"
              fill="#4C8CFF"
              stroke="#FFFFFF"
              strokeWidth="3"
            />
          )}
        </Svg>
        
        {/* Y-axis labels */}
        <View style={styles.yAxisLabels}>
          {yLabels.map((label, index) => (
            <Text key={index} style={[styles.yAxisLabel, { top: label.y - 8 }]}>
              {label.value}
            </Text>
          ))}
        </View>
        
        {/* X-axis labels */}
        <View style={styles.xAxisLabels}>
          {pointsToRender.map((point, renderIndex) => {
            const originalIndex = sortedData.indexOf(point);
            const shouldRenderLabel = renderIndex % Math.max(1, Math.ceil(pointsToRender.length / 5)) === 0
              || originalIndex === sortedData.length - 1;

            if (!shouldRenderLabel) {
              return null;
            }

            return (
              <Text
                key={`label-${point.date}`}
                style={[
                  styles.xAxisLabel,
                  {
                    left: (() => {
                      const relativeX = getX(originalIndex) - padding.left;
                      const chartContentWidth = chartWidth - padding.left - padding.right;
                      const clamped = Math.max(
                        0,
                        Math.min(chartContentWidth - LABEL_WIDTH, relativeX - LABEL_WIDTH / 2)
                      );
                      return clamped;
                    })(),
                  },
                ]}
              >
                {getDateLabel(point.date)}
              </Text>
            );
          })}
        </View>
      </View>
      
      {/* Chart info */}
      <View style={styles.chartInfo}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <View style={[styles.colorIndicator, { backgroundColor: '#3CC8A9' }]} />
            <Text style={styles.infoLabel}>Weight</Text>
          </View>
          {trendLine && (
            <View style={styles.infoItem}>
              <View style={[styles.colorIndicator, { backgroundColor: '#4C8CFF' }]} />
              <Text style={styles.infoLabel}>Trend</Text>
            </View>
          )}
        </View>
        
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {sortedData.length > 0 ? sortedData[sortedData.length - 1].value.toFixed(1) : '--'}
            </Text>
            <Text style={styles.statLabel}>Latest ({weightUnit})</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {sortedData.length > 1 
                ? (sortedData[sortedData.length - 1].value - sortedData[0].value).toFixed(1)
                : '--'
              }
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
    position: 'relative',
    marginBottom: 16,
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
  yAxisLabels: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: padding.left,
    height: chartHeight,
  },
  yAxisLabel: {
    position: 'absolute',
    fontSize: 12,
    color: '#9AACD1',
    textAlign: 'right',
    width: padding.left - 8,
  },
  xAxisLabels: {
    position: 'absolute',
    left: padding.left,
    bottom: 0,
    width: chartWidth - padding.left - padding.right,
    height: padding.bottom,
  },
  xAxisLabel: {
    position: 'absolute',
    fontSize: 12,
    color: '#9AACD1',
    textAlign: 'center',
    width: 40,
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

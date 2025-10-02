/**
 * Weight Statistics Component
 * Displays comprehensive weight statistics and metrics
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WeightAnalysis } from '../../lib/services/healthkit/weight-trends';
import type { HealthMetricPoint } from '../../lib/services/healthkit/health-metrics';

interface WeightStatisticsProps {
  analysis: WeightAnalysis;
  data: HealthMetricPoint[];
  weightUnit: string;
}

export function WeightStatistics({ analysis, data, weightUnit }: WeightStatisticsProps) {
  const { statistics, trends } = analysis;

  // Calculate additional metrics
  const totalChange = data.length > 1 ? data[data.length - 1].value - data[0].value : 0;
  const totalDays = data.length > 1 ? 
    Math.ceil((data[data.length - 1].date - data[0].date) / (24 * 60 * 60 * 1000)) : 0;
  
  const averageWeeklyChange = totalDays > 0 ? (totalChange / totalDays) * 7 : 0;
  
  // Calculate weight range (min to max)
  const weightRange = statistics.max - statistics.min;
  
  // Calculate coefficient of variation (stability metric)
  const coefficientOfVariation = statistics.average > 0 ? 
    (statistics.standardDeviation / statistics.average) * 100 : 0;

  const statCards: {
    title: string;
    value: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    description: string;
  }[] = [
    {
      title: 'Average Weight',
      value: `${statistics.average.toFixed(1)} ${weightUnit}`,
      icon: 'analytics-outline',
      color: '#4C8CFF',
      description: 'Mean weight over the period',
    },
    {
      title: 'Weight Range',
      value: `${weightRange.toFixed(1)} ${weightUnit}`,
      icon: 'resize-outline',
      color: '#3CC8A9',
      description: `${statistics.min.toFixed(1)} - ${statistics.max.toFixed(1)} ${weightUnit}`,
    },
    {
      title: 'Weekly Change',
      value: `${averageWeeklyChange >= 0 ? '+' : ''}${averageWeeklyChange.toFixed(2)} ${weightUnit}`,
      icon: 'trending-up-outline',
      color: averageWeeklyChange > 0 ? '#FF6B6B' : averageWeeklyChange < 0 ? '#3CC8A9' : '#4C8CFF',
      description: 'Average change per week',
    },
    {
      title: 'Stability',
      value: `${(100 - coefficientOfVariation).toFixed(0)}%`,
      icon: 'shield-checkmark-outline',
      color: coefficientOfVariation < 5 ? '#3CC8A9' : coefficientOfVariation < 10 ? '#FF9500' : '#FF6B6B',
      description: 'Weight consistency score',
    },
  ];

  const trendCards: {
    title: string;
    trend: any;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    {
      title: 'Short Term (7 days)',
      trend: trends.shortTerm,
      icon: 'calendar-outline',
    },
    {
      title: 'Medium Term (30 days)',
      trend: trends.mediumTerm,
      icon: 'calendar-outline',
    },
    {
      title: 'Long Term (90 days)',
      trend: trends.longTerm,
      icon: 'calendar-outline',
    },
  ];

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'losing':
        return 'trending-down';
      case 'gaining':
        return 'trending-up';
      case 'stable':
        return 'remove';
      case 'fluctuating':
        return 'swap-horizontal';
      default:
        return 'help';
    }
  };

  const getTrendColor = (direction: string) => {
    switch (direction) {
      case 'losing':
        return '#3CC8A9';
      case 'gaining':
        return '#FF6B6B';
      case 'stable':
        return '#4C8CFF';
      case 'fluctuating':
        return '#FF9500';
      default:
        return '#9AACD1';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Weight Statistics</Text>
      
      {/* Main Statistics Grid */}
      <View style={styles.statsGrid}>
        {statCards.map((card, index) => (
          <View key={index} style={styles.statCard}>
            <View style={styles.statHeader}>
              <View style={[styles.iconContainer, { backgroundColor: card.color }]}>
                <Ionicons name={card.icon} size={20} color="#FFFFFF" />
              </View>
              <Text style={styles.statTitle}>{card.title}</Text>
            </View>
            <Text style={styles.statValue}>{card.value}</Text>
            <Text style={styles.statDescription}>{card.description}</Text>
          </View>
        ))}
      </View>

      {/* Trend Analysis */}
      <Text style={styles.sectionTitle}>Trend Analysis</Text>
      
      {trendCards.map((card, index) => (
        <View key={index} style={styles.trendCard}>
          <View style={styles.trendHeader}>
            <Ionicons name={card.icon} size={16} color="#9AACD1" />
            <Text style={styles.trendTitle}>{card.title}</Text>
            <View style={styles.trendIndicator}>
              <Ionicons 
                name={getTrendIcon(card.trend.direction)} 
                size={16} 
                color={getTrendColor(card.trend.direction)} 
              />
              <Text style={[styles.trendDirection, { color: getTrendColor(card.trend.direction) }]}>
                {card.trend.direction}
              </Text>
            </View>
          </View>
          
          <View style={styles.trendMetrics}>
            <View style={styles.trendMetric}>
              <Text style={styles.trendMetricLabel}>Rate</Text>
              <Text style={styles.trendMetricValue}>
                {Math.abs(card.trend.rate) > 0.01 
                  ? `${card.trend.rate > 0 ? '+' : ''}${card.trend.rate.toFixed(2)} ${weightUnit}/week`
                  : 'Stable'
                }
              </Text>
            </View>
            
            <View style={styles.trendMetric}>
              <Text style={styles.trendMetricLabel}>Confidence</Text>
              <Text style={styles.trendMetricValue}>
                {(card.trend.confidence * 100).toFixed(0)}%
              </Text>
            </View>
            
            <View style={styles.trendMetric}>
              <Text style={styles.trendMetricLabel}>Strength</Text>
              <Text style={[styles.trendMetricValue, { 
                color: card.trend.trendStrength === 'strong' ? '#3CC8A9' : 
                       card.trend.trendStrength === 'moderate' ? '#FF9500' : '#9AACD1'
              }]}>
                {card.trend.trendStrength}
              </Text>
            </View>
          </View>
          
          {card.trend.insights.length > 0 && (
            <View style={styles.trendInsights}>
              {card.trend.insights.map((insight: string, insightIndex: number) => (
                <Text key={insightIndex} style={styles.trendInsight}>
                  • {insight}
                </Text>
              ))}
            </View>
          )}
        </View>
      ))}

      {/* Data Quality */}
      <View style={styles.dataQualityCard}>
        <Text style={styles.dataQualityTitle}>Data Quality</Text>
        <View style={styles.dataQualityMetrics}>
          <View style={styles.dataQualityMetric}>
            <Text style={styles.dataQualityLabel}>Data Points</Text>
            <Text style={styles.dataQualityValue}>{data.length}</Text>
          </View>
          <View style={styles.dataQualityMetric}>
            <Text style={styles.dataQualityLabel}>Tracking Days</Text>
            <Text style={styles.dataQualityValue}>{totalDays}</Text>
          </View>
          <View style={styles.dataQualityMetric}>
            <Text style={styles.dataQualityLabel}>Frequency</Text>
            <Text style={styles.dataQualityValue}>
              {totalDays > 0 ? (data.length / totalDays * 7).toFixed(1) : '0'}x/week
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
    marginTop: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  statTitle: {
    fontSize: 12,
    color: '#9AACD1',
    fontWeight: '500',
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  statDescription: {
    fontSize: 11,
    color: '#9AACD1',
  },
  trendCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  trendTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    flex: 1,
  },
  trendIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendDirection: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  trendMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trendMetric: {
    flex: 1,
    alignItems: 'center',
  },
  trendMetricLabel: {
    fontSize: 11,
    color: '#9AACD1',
    marginBottom: 4,
  },
  trendMetricValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  trendInsights: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 12,
  },
  trendInsight: {
    fontSize: 12,
    color: '#9AACD1',
    marginBottom: 4,
    lineHeight: 16,
  },
  dataQualityCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  dataQualityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 12,
  },
  dataQualityMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dataQualityMetric: {
    flex: 1,
    alignItems: 'center',
  },
  dataQualityLabel: {
    fontSize: 11,
    color: '#9AACD1',
    marginBottom: 4,
  },
  dataQualityValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5F7FF',
  },
});

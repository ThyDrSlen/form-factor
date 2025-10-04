/**
 * Comprehensive Weight Dashboard
 * Advanced weight tracking with trends, predictions, and insights
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useHealthKit } from '../../contexts/HealthKitContext';
import { useUnits } from '../../contexts/UnitsContext';
import { WeightTrendChart } from './WeightTrendChart.chartkit';
import { WeightInsights } from './WeightInsights';
import { WeightStatistics } from './WeightStatistics';
import { WeightGoals } from './WeightGoals';
import { WeightPredictions } from './WeightPredictions';

interface WeightDashboardProps {
  onClose?: () => void;
}

export function WeightDashboard({ onClose }: WeightDashboardProps) {
  const { weightAnalysis, /* weightHistory90Days, */ weightHistory180Days } = useHealthKit();
  const { convertWeight, getWeightLabel } = useUnits();
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d' | '90d' | '180d'>('90d');
  const [activeTab, setActiveTab] = useState<'overview' | 'trends' | 'insights' | 'goals'>('overview');

  // Get data for selected period
  const getDataForPeriod = useMemo(() => {
    if (!weightAnalysis) return [];
    
    const now = Date.now();
    const periodMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      '180d': 180 * 24 * 60 * 60 * 1000,
    };
    
    const cutoff = now - periodMs[selectedPeriod];
    // Use 180-day history for better data coverage
    return weightHistory180Days.filter(point => point.date >= cutoff);
  }, [weightHistory180Days, selectedPeriod, weightAnalysis]);

  // Convert weights to user's preferred unit
  const convertedData = useMemo(() => {
    return getDataForPeriod.map(point => ({
      ...point,
      value: convertWeight(point.value),
    }));
  }, [getDataForPeriod, convertWeight]);

  const getCurrentWeight = () => {
    if (!weightAnalysis) return null;
    return convertWeight(weightAnalysis.current.weight);
  };

  const getTrendForPeriod = () => {
    if (!weightAnalysis) return null;
    
    switch (selectedPeriod) {
      case '7d':
        return weightAnalysis.trends.shortTerm;
      case '30d':
        return weightAnalysis.trends.mediumTerm;
      case '90d':
        return weightAnalysis.trends.longTerm;
      default:
        return weightAnalysis.trends.longTerm;
    }
  };

  const currentWeight = getCurrentWeight();
  const currentTrend = getTrendForPeriod();

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

  if (!weightAnalysis) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Weight Tracking</Text>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#F5F7FF" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="scale-outline" size={64} color="#9AACD1" />
          <Text style={styles.emptyTitle}>No Weight Data</Text>
          <Text style={styles.emptySubtitle}>
            Connect HealthKit to start tracking your weight trends
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Weight Dashboard</Text>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#F5F7FF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Current Weight Card */}
      <View style={styles.currentWeightCard}>
        <View style={styles.currentWeightHeader}>
          <Text style={styles.currentWeightLabel}>Current Weight</Text>
          <View style={styles.trendIndicator}>
            <Ionicons 
              name={getTrendIcon(currentTrend?.direction || 'stable')} 
              size={16} 
              color={getTrendColor(currentTrend?.direction || 'stable')} 
            />
            <Text style={[styles.trendText, { color: getTrendColor(currentTrend?.direction || 'stable') }]}>
              {currentTrend?.direction || 'stable'}
            </Text>
          </View>
        </View>
        <Text style={styles.currentWeightValue}>
          {currentWeight ? `${currentWeight.toFixed(1)} ${getWeightLabel()}` : 'No data'}
        </Text>
        {currentTrend && (
          <Text style={styles.currentWeightChange}>
            {Math.abs(currentTrend.rate) > 0.01 
              ? `${currentTrend.rate > 0 ? '+' : ''}${currentTrend.rate.toFixed(2)} ${getWeightLabel()}/week`
              : 'Stable'
            }
          </Text>
        )}
      </View>

      {/* Period Selector */}
      <View style={styles.periodSelector}>
        {(['7d', '30d', '90d', '180d'] as const).map((period) => (
          <TouchableOpacity
            key={period}
            style={[
              styles.periodButton,
              selectedPeriod === period && styles.periodButtonActive,
            ]}
            onPress={() => setSelectedPeriod(period)}
          >
            <Text style={[
              styles.periodButtonText,
              selectedPeriod === period && styles.periodButtonTextActive,
            ]}>
              {period === '7d' ? '7D' : period === '30d' ? '30D' : period === '90d' ? '90D' : '6M'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabNavigation}>
        {[
          { key: 'overview', label: 'Overview', icon: 'analytics-outline' },
          { key: 'trends', label: 'Trends', icon: 'trending-up-outline' },
          { key: 'insights', label: 'Insights', icon: 'bulb-outline' },
          { key: 'goals', label: 'Goals', icon: 'flag-outline' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tabButton,
              activeTab === tab.key && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab(tab.key as any)}
          >
            <Ionicons 
              name={tab.icon as any} 
              size={16} 
              color={activeTab === tab.key ? '#4C8CFF' : '#9AACD1'} 
            />
            <Text style={[
              styles.tabButtonText,
              activeTab === tab.key && styles.tabButtonTextActive,
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === 'overview' && (
        <View style={styles.tabContent}>
          <WeightTrendChart 
            data={convertedData} 
            period={selectedPeriod}
            weightUnit={getWeightLabel()}
          />
          <WeightStatistics 
            analysis={weightAnalysis}
            data={convertedData}
            weightUnit={getWeightLabel()}
          />
        </View>
      )}

      {activeTab === 'trends' && (
        <View style={styles.tabContent}>
          <WeightTrendChart 
            data={convertedData} 
            period={selectedPeriod}
            weightUnit={getWeightLabel()}
            showPredictions={true}
          />
          <WeightPredictions 
            analysis={weightAnalysis}
            weightUnit={getWeightLabel()}
            convertWeight={convertWeight}
          />
        </View>
      )}

      {activeTab === 'insights' && (
        <View style={styles.tabContent}>
          <WeightInsights 
            analysis={weightAnalysis}
            currentTrend={currentTrend}
            weightUnit={getWeightLabel()}
          />
        </View>
      )}

      {activeTab === 'goals' && (
        <View style={styles.tabContent}>
          <WeightGoals 
            analysis={weightAnalysis}
            weightUnit={getWeightLabel()}
            convertWeight={convertWeight}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F5F7FF',
  },
  closeButton: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 24,
  },
  currentWeightCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  currentWeightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  currentWeightLabel: {
    fontSize: 14,
    color: '#9AACD1',
    fontWeight: '600',
  },
  trendIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  currentWeightValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  currentWeightChange: {
    fontSize: 14,
    color: '#9AACD1',
  },
  periodSelector: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 4,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  periodButtonActive: {
    backgroundColor: '#4C8CFF',
  },
  periodButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9AACD1',
  },
  periodButtonTextActive: {
    color: '#FFFFFF',
  },
  tabNavigation: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabButtonActive: {
    backgroundColor: '#4C8CFF',
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AACD1',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  tabContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
});

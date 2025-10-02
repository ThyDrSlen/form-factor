/**
 * Weight Insights Component
 * Provides intelligent insights and recommendations based on weight trends
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WeightAnalysis, WeightTrend } from '../../lib/services/healthkit/weight-trends';

interface WeightInsightsProps {
  analysis: WeightAnalysis;
  currentTrend: WeightTrend | null;
  weightUnit: string;
}

export function WeightInsights({ analysis, currentTrend, weightUnit }: WeightInsightsProps) {
  const insights = generateInsights(analysis, currentTrend, weightUnit);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weight Insights</Text>
      
      {insights.map((insight, index) => (
        <View key={index} style={styles.insightCard}>
          <View style={styles.insightHeader}>
            <View style={[styles.iconContainer, { backgroundColor: insight.color }]}>
              <Ionicons name={insight.icon} size={20} color="#FFFFFF" />
            </View>
            <View style={styles.insightTitleContainer}>
              <Text style={styles.insightTitle}>{insight.title}</Text>
              <Text style={styles.insightCategory}>{insight.category}</Text>
            </View>
          </View>
          <Text style={styles.insightDescription}>{insight.description}</Text>
          {insight.action && (
            <Text style={styles.insightAction}>{insight.action}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

interface Insight {
  title: string;
  description: string;
  category: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  action?: string;
}

function generateInsights(
  analysis: WeightAnalysis,
  currentTrend: WeightTrend | null,
  weightUnit: string
): Insight[] {
  const insights: Insight[] = [];
  const { statistics, patterns } = analysis;

  // Trend-based insights
  if (currentTrend) {
    switch (currentTrend.direction) {
      case 'losing':
        if (Math.abs(currentTrend.rate) > 0.8) {
          insights.push({
            title: 'Rapid Weight Loss',
            description: `You're losing ${Math.abs(currentTrend.rate).toFixed(1)} ${weightUnit} per week. This is faster than the recommended 0.5-1 ${weightUnit}/week.`,
            category: 'Health',
            icon: 'warning',
            color: '#FF9500',
            action: 'Consider consulting a healthcare provider to ensure safe weight loss.',
          });
        } else if (Math.abs(currentTrend.rate) > 0.2) {
          insights.push({
            title: 'Healthy Weight Loss',
            description: `Great job! You're losing ${Math.abs(currentTrend.rate).toFixed(1)} ${weightUnit} per week, which is within the healthy range.`,
            category: 'Progress',
            icon: 'checkmark-circle',
            color: '#3CC8A9',
            action: 'Keep up the consistent effort with your diet and exercise routine.',
          });
        }
        break;

      case 'gaining':
        if (currentTrend.rate > 0.5) {
          insights.push({
            title: 'Weight Gain Trend',
            description: `Your weight has been increasing by ${currentTrend.rate.toFixed(1)} ${weightUnit} per week.`,
            category: 'Attention',
            icon: 'trending-up',
            color: '#FF6B6B',
            action: 'Consider reviewing your calorie intake and increasing physical activity.',
          });
        }
        break;

      case 'stable':
        insights.push({
          title: 'Weight Maintenance',
          description: 'Your weight has been stable, which is great for maintaining your current health.',
          category: 'Stability',
          icon: 'scale',
          color: '#4C8CFF',
          action: 'Continue with your current routine to maintain this stability.',
        });
        break;

      case 'fluctuating':
        insights.push({
          title: 'Weight Fluctuations',
          description: 'Your weight is showing some fluctuations, which is normal.',
          category: 'Normal',
          icon: 'swap-horizontal',
          color: '#9B7EDE',
          action: 'Try weighing yourself at the same time each day for more consistent tracking.',
        });
        break;
    }
  }

  // Statistical insights
  if (statistics.standardDeviation > 1.5) {
    insights.push({
      title: 'High Weight Variability',
      description: `Your weight varies by ${statistics.standardDeviation.toFixed(1)} ${weightUnit} on average.`,
      category: 'Variability',
      icon: 'stats-chart',
      color: '#FF9500',
      action: 'Consider tracking your weight at consistent times and conditions.',
    });
  }

  // Pattern insights
  if (patterns.weeklyPattern) {
    const { dayOfWeek, averageWeight, significance } = patterns.weeklyPattern;
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    if (significance > 0.3) {
      insights.push({
        title: 'Weekly Weight Pattern',
        description: `Your weight tends to be ${averageWeight.toFixed(1)} ${weightUnit} on ${dayNames[dayOfWeek]}s.`,
        category: 'Pattern',
        icon: 'calendar',
        color: '#4C8CFF',
        action: 'This could be related to your weekly routine or eating patterns.',
      });
    }
  }

  // Consistency insights
  const totalDays = analysis.statistics.average > 0 ? 
    Math.ceil((Date.now() - Math.min(...analysis.trends.longTerm.insights.map(() => Date.now()))) / (24 * 60 * 60 * 1000)) : 0;
  
  if (totalDays > 0) {
    const trackingFrequency = analysis.statistics.average / totalDays;
    if (trackingFrequency < 0.5) {
      insights.push({
        title: 'Inconsistent Tracking',
        description: 'You\'re not tracking your weight regularly. Consistent tracking helps identify patterns.',
        category: 'Tracking',
        icon: 'time',
        color: '#FF9500',
        action: 'Try to weigh yourself daily at the same time for better insights.',
      });
    } else {
      insights.push({
        title: 'Consistent Tracking',
        description: 'Great job tracking your weight regularly! This helps provide accurate insights.',
        category: 'Tracking',
        icon: 'checkmark-circle',
        color: '#3CC8A9',
        action: 'Keep up the consistent tracking for better trend analysis.',
      });
    }
  }

  // Goal-related insights
  if (analysis.goals.recommendations.length > 0) {
    insights.push({
      title: 'Goal Progress',
      description: analysis.goals.recommendations[0],
      category: 'Goals',
      icon: 'flag',
      color: '#4C8CFF',
      action: analysis.goals.estimatedTimeToGoal ? 
        `Estimated time to reach your goal: ${Math.ceil(analysis.goals.estimatedTimeToGoal / 7)} weeks` : 
        undefined,
    });
  }

  // Confidence insights
  if (currentTrend && currentTrend.confidence < 0.5) {
    insights.push({
      title: 'Low Trend Confidence',
      description: 'The current trend analysis has low confidence due to limited or inconsistent data.',
      category: 'Data Quality',
      icon: 'information-circle',
      color: '#9B7EDE',
      action: 'Track your weight more consistently to improve trend accuracy.',
    });
  }

  // Return insights sorted by importance
  return insights.sort((a, b) => {
    const priority = { 'Health': 1, 'Attention': 2, 'Progress': 3, 'Stability': 4, 'Normal': 5, 'Pattern': 6, 'Tracking': 7, 'Goals': 8, 'Data Quality': 9, 'Variability': 10 };
    return (priority[a.category as keyof typeof priority] || 999) - (priority[b.category as keyof typeof priority] || 999);
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 20,
  },
  insightCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  insightTitleContainer: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 2,
  },
  insightCategory: {
    fontSize: 12,
    color: '#9AACD1',
    fontWeight: '500',
  },
  insightDescription: {
    fontSize: 14,
    color: '#F5F7FF',
    lineHeight: 20,
    marginBottom: 8,
  },
  insightAction: {
    fontSize: 14,
    color: '#4C8CFF',
    fontWeight: '500',
    fontStyle: 'italic',
  },
});

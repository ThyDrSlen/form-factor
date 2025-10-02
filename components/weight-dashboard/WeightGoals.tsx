/**
 * Weight Goals Component
 * Helps users set and track weight goals
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WeightAnalysis } from '../../lib/services/healthkit/weight-trends';

interface WeightGoalsProps {
  analysis: WeightAnalysis;
  weightUnit: string;
  convertWeight: (value: number) => number;
}

export function WeightGoals({ analysis, weightUnit, convertWeight }: WeightGoalsProps) {
  const [goalWeight, setGoalWeight] = useState('');

  const currentWeight = convertWeight(analysis.current.weight);
  const goalDifference = goalWeight ? parseFloat(goalWeight) - currentWeight : 0;
  const isWeightLoss = goalDifference < 0;

  const estimatedTimeWeeks = analysis.goals.estimatedTimeToGoal 
    ? Math.ceil(analysis.goals.estimatedTimeToGoal / 7) 
    : null;

  const handleSetGoal = () => {
    if (!goalWeight) {
      Alert.alert('Error', 'Please enter a target weight');
      return;
    }

    Alert.alert(
      'Goal Set',
      `Target weight set to ${goalWeight} ${weightUnit}`,
      [{ text: 'OK' }]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weight Goals</Text>

      {/* Current Status */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Ionicons name="fitness-outline" size={24} color="#4C8CFF" />
          <Text style={styles.statusTitle}>Current Status</Text>
        </View>
        <Text style={styles.statusValue}>
          {currentWeight.toFixed(1)} {weightUnit}
        </Text>
        <Text style={styles.statusDescription}>Your current weight</Text>
      </View>

      {/* Goal Input */}
      <View style={styles.goalInputCard}>
        <Text style={styles.goalInputLabel}>Target Weight ({weightUnit})</Text>
        <TextInput
          style={styles.goalInput}
          value={goalWeight}
          onChangeText={setGoalWeight}
          placeholder={`Enter target weight in ${weightUnit}`}
          placeholderTextColor="#9AACD1"
          keyboardType="decimal-pad"
        />
        
        {goalWeight && (
          <View style={styles.goalDifferenceContainer}>
            <Ionicons 
              name={isWeightLoss ? 'trending-down' : 'trending-up'} 
              size={16} 
              color={isWeightLoss ? '#3CC8A9' : '#FF6B6B'} 
            />
            <Text style={[styles.goalDifference, { 
              color: isWeightLoss ? '#3CC8A9' : '#FF6B6B' 
            }]}>
              {Math.abs(goalDifference).toFixed(1)} {weightUnit} {isWeightLoss ? 'to lose' : 'to gain'}
            </Text>
          </View>
        )}

        <TouchableOpacity style={styles.setGoalButton} onPress={handleSetGoal}>
          <Text style={styles.setGoalButtonText}>Set Goal</Text>
        </TouchableOpacity>
      </View>

      {/* Recommendations */}
      {analysis.goals.recommendations.length > 0 && (
        <View style={styles.recommendationsCard}>
          <View style={styles.recommendationsHeader}>
            <Ionicons name="bulb-outline" size={20} color="#FF9500" />
            <Text style={styles.recommendationsTitle}>Recommendations</Text>
          </View>
          {analysis.goals.recommendations.map((recommendation, index) => (
            <Text key={index} style={styles.recommendation}>
              • {recommendation}
            </Text>
          ))}
        </View>
      )}

      {/* Estimated Timeline */}
      {estimatedTimeWeeks && (
        <View style={styles.timelineCard}>
          <View style={styles.timelineHeader}>
            <Ionicons name="time-outline" size={20} color="#4C8CFF" />
            <Text style={styles.timelineTitle}>Estimated Timeline</Text>
          </View>
          <Text style={styles.timelineValue}>
            {estimatedTimeWeeks} weeks
          </Text>
          <Text style={styles.timelineDescription}>
            Based on your current trend
          </Text>
        </View>
      )}

      {/* Goal Tips */}
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>Tips for Success</Text>
        <View style={styles.tipsList}>
          <View style={styles.tip}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.tipText}>Set realistic, achievable goals</Text>
          </View>
          <View style={styles.tip}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.tipText}>Aim for 0.5-1 {weightUnit}/week change</Text>
          </View>
          <View style={styles.tip}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.tipText}>Track consistently for best results</Text>
          </View>
          <View style={styles.tip}>
            <Ionicons name="checkmark-circle" size={16} color="#3CC8A9" />
            <Text style={styles.tipText}>Consult healthcare provider for major changes</Text>
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
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 20,
  },
  statusCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  statusValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  statusDescription: {
    fontSize: 14,
    color: '#9AACD1',
  },
  goalInputCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  goalInputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 8,
  },
  goalInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#F5F7FF',
    marginBottom: 12,
  },
  goalDifferenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  goalDifference: {
    fontSize: 14,
    fontWeight: '600',
  },
  setGoalButton: {
    backgroundColor: '#4C8CFF',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  setGoalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  recommendationsCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  recommendationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  recommendationsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  recommendation: {
    fontSize: 14,
    color: '#F5F7FF',
    marginBottom: 8,
    lineHeight: 20,
  },
  timelineCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  timelineTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  timelineValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#4C8CFF',
    marginBottom: 4,
  },
  timelineDescription: {
    fontSize: 14,
    color: '#9AACD1',
  },
  tipsCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 12,
  },
  tipsList: {
    gap: 12,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipText: {
    fontSize: 14,
    color: '#F5F7FF',
    flex: 1,
  },
});

/**
 * Weight Predictions Component
 * Shows future weight predictions based on current trends
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WeightAnalysis } from '../../lib/services/healthkit/weight-trends';

interface WeightPredictionsProps {
  analysis: WeightAnalysis;
  weightUnit: string;
  convertWeight: (kg: number) => number;
}

export function WeightPredictions({ analysis, weightUnit, convertWeight }: WeightPredictionsProps) {
  const { trends } = analysis;
  
  // Use the most confident trend for predictions
  const predictionTrend = trends.shortTerm.confidence > trends.mediumTerm.confidence 
    ? trends.shortTerm 
    : trends.mediumTerm;
  
  const predictions = predictionTrend.predictions || [];
  
  if (predictions.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Weight Predictions</Text>
        <View style={styles.noPredictionsContainer}>
          <Ionicons name="analytics-outline" size={48} color="#9AACD1" />
          <Text style={styles.noPredictionsText}>No predictions available</Text>
          <Text style={styles.noPredictionsSubtext}>
            Need more consistent data for accurate predictions
          </Text>
        </View>
      </View>
    );
  }

  const currentWeight = convertWeight(analysis.current.weight);
  const predictedWeight = predictions.length > 0 ? convertWeight(predictions[predictions.length - 1].predictedWeight) : currentWeight;
  const weightChange = predictedWeight - currentWeight;
  const confidence = predictions.length > 0 ? predictions[predictions.length - 1].confidence : 0;

  const getConfidenceColor = (conf: number) => {
    if (conf > 0.7) return '#3CC8A9';
    if (conf > 0.4) return '#FF9500';
    return '#FF6B6B';
  };

  const getConfidenceLabel = (conf: number) => {
    if (conf > 0.7) return 'High';
    if (conf > 0.4) return 'Medium';
    return 'Low';
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weight Predictions</Text>
      
      {/* Prediction Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Ionicons name="trending-up-outline" size={24} color="#4C8CFF" />
          <Text style={styles.summaryTitle}>7-Day Forecast</Text>
        </View>
        
        <View style={styles.summaryContent}>
          <View style={styles.currentWeightContainer}>
            <Text style={styles.weightLabel}>Current</Text>
            <Text style={styles.weightValue}>{currentWeight.toFixed(1)} {weightUnit}</Text>
          </View>
          
          <View style={styles.arrowContainer}>
            <Ionicons 
              name={weightChange > 0 ? "arrow-up" : weightChange < 0 ? "arrow-down" : "remove"} 
              size={24} 
              color={weightChange > 0 ? "#FF6B6B" : weightChange < 0 ? "#3CC8A9" : "#4C8CFF"} 
            />
            <Text style={[
              styles.changeText,
              { color: weightChange > 0 ? "#FF6B6B" : weightChange < 0 ? "#3CC8A9" : "#4C8CFF" }
            ]}>
              {Math.abs(weightChange).toFixed(1)} {weightUnit}
            </Text>
          </View>
          
          <View style={styles.predictedWeightContainer}>
            <Text style={styles.weightLabel}>Predicted</Text>
            <Text style={styles.weightValue}>{predictedWeight.toFixed(1)} {weightUnit}</Text>
          </View>
        </View>
        
        <View style={styles.confidenceContainer}>
          <View style={styles.confidenceIndicator}>
            <View style={[styles.confidenceBar, { 
              width: `${confidence * 100}%`,
              backgroundColor: getConfidenceColor(confidence)
            }]} />
          </View>
          <Text style={[styles.confidenceText, { color: getConfidenceColor(confidence) }]}>
            {getConfidenceLabel(confidence)} Confidence
          </Text>
        </View>
      </View>

      {/* Daily Predictions */}
      <View style={styles.predictionsCard}>
        <Text style={styles.predictionsTitle}>Daily Predictions</Text>
        
        {predictions.map((prediction, index) => {
          const date = new Date(prediction.date);
          const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
          const dayNumber = date.getDate();
          const predictedWeightConverted = convertWeight(prediction.predictedWeight);
          
          return (
            <View key={index} style={styles.predictionRow}>
              <View style={styles.dateContainer}>
                <Text style={styles.dayName}>{dayName}</Text>
                <Text style={styles.dayNumber}>{dayNumber}</Text>
              </View>
              
              <View style={styles.weightContainer}>
                <Text style={styles.predictedWeight}>{predictedWeightConverted.toFixed(1)} {weightUnit}</Text>
                <Text style={styles.predictionChange}>
                  {index === 0 ? 'Today' : 
                   `${(predictedWeightConverted - currentWeight).toFixed(1)} ${weightUnit}`}
                </Text>
              </View>
              
              <View style={styles.confidenceContainer}>
                <View style={[styles.smallConfidenceBar, { 
                  width: `${prediction.confidence * 100}%`,
                  backgroundColor: getConfidenceColor(prediction.confidence)
                }]} />
                <Text style={[styles.smallConfidenceText, { color: getConfidenceColor(prediction.confidence) }]}>
                  {(prediction.confidence * 100).toFixed(0)}%
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimerCard}>
        <Ionicons name="information-circle-outline" size={20} color="#9AACD1" />
        <Text style={styles.disclaimerText}>
          Predictions are based on current trends and should not replace professional medical advice.
        </Text>
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
  noPredictionsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noPredictionsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginTop: 12,
    marginBottom: 8,
  },
  noPredictionsSubtext: {
    fontSize: 14,
    color: '#9AACD1',
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  summaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  currentWeightContainer: {
    alignItems: 'center',
    flex: 1,
  },
  predictedWeightContainer: {
    alignItems: 'center',
    flex: 1,
  },
  weightLabel: {
    fontSize: 12,
    color: '#9AACD1',
    marginBottom: 4,
  },
  weightValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F5F7FF',
  },
  arrowContainer: {
    alignItems: 'center',
    flex: 1,
  },
  changeText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  confidenceContainer: {
    alignItems: 'center',
  },
  confidenceIndicator: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  confidenceBar: {
    height: '100%',
    borderRadius: 2,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '600',
  },
  predictionsCard: {
    backgroundColor: 'rgba(15, 35, 57, 0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  predictionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
  },
  predictionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  dateContainer: {
    alignItems: 'center',
    width: 60,
    marginRight: 16,
  },
  dayName: {
    fontSize: 12,
    color: '#9AACD1',
    marginBottom: 2,
  },
  dayNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  weightContainer: {
    flex: 1,
  },
  predictedWeight: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 2,
  },
  predictionChange: {
    fontSize: 12,
    color: '#9AACD1',
  },
  smallConfidenceBar: {
    height: 3,
    borderRadius: 2,
    marginBottom: 4,
  },
  smallConfidenceText: {
    fontSize: 10,
    fontWeight: '500',
  },
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 149, 0, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.3)',
    gap: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: '#FF9500',
    lineHeight: 16,
  },
});

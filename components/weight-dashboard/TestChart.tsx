/**
 * Simple test chart to debug chart rendering issues
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - 40;
const chartHeight = 220;

export function TestChart() {
  // Simple test data
  const testData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        data: [20, 45, 28, 80, 99, 43, 50],
        color: (opacity = 1) => `rgba(60, 200, 169, ${opacity})`,
        strokeWidth: 3,
      },
    ],
  };

  console.log('TestChart - Rendering with test data:', testData);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Test Chart</Text>
      <View style={styles.chartWrapper}>
        <LineChart
          data={testData}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  title: {
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
});

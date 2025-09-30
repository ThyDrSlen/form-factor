/**
 * Advanced Weight Trend Analysis
 * Comprehensive algorithms for analyzing weight data trends and patterns
 */

import type { HealthMetricPoint } from './health-metrics';

export interface WeightTrend {
  direction: 'gaining' | 'losing' | 'stable' | 'fluctuating';
  rate: number; // kg per week
  confidence: number; // 0-1
  trendStrength: 'weak' | 'moderate' | 'strong';
  period: string; // e.g., "last 7 days", "last 30 days"
  insights: string[];
  predictions?: WeightPrediction[];
}

export interface WeightPrediction {
  date: number;
  predictedWeight: number;
  confidence: number;
}

export interface WeightAnalysis {
  current: {
    weight: number;
    timestamp: number;
  };
  trends: {
    shortTerm: WeightTrend; // 7 days
    mediumTerm: WeightTrend; // 30 days
    longTerm: WeightTrend; // 90 days
  };
  statistics: {
    average: number;
    median: number;
    min: number;
    max: number;
    standardDeviation: number;
    variance: number;
  };
  patterns: {
    weeklyPattern?: WeeklyPattern;
    monthlyPattern?: MonthlyPattern;
    seasonality?: SeasonalityPattern;
  };
  goals: {
    progress: number; // percentage toward goal
    estimatedTimeToGoal?: number; // days
    recommendations: string[];
  };
}

export interface WeeklyPattern {
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  averageWeight: number;
  trend: 'higher' | 'lower' | 'neutral';
  significance: number;
}

export interface MonthlyPattern {
  weekOfMonth: number; // 1-4
  averageWeight: number;
  trend: 'higher' | 'lower' | 'neutral';
  significance: number;
}

export interface SeasonalityPattern {
  period: number; // days in cycle
  amplitude: number; // weight variation
  phase: number; // offset in days
  significance: number;
}

/**
 * Calculate linear regression for weight trend
 */
function calculateLinearRegression(points: HealthMetricPoint[]): {
  slope: number;
  intercept: number;
  rSquared: number;
} {
  if (points.length < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }

  const n = points.length;
  const xValues = points.map((_, index) => index);
  const yValues = points.map(p => p.value);

  const sumX = xValues.reduce((sum, x) => sum + x, 0);
  const sumY = yValues.reduce((sum, y) => sum + y, 0);
  const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
  const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);
  const sumYY = yValues.reduce((sum, y) => sum + y * y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const yMean = sumY / n;
  const ssRes = yValues.reduce((sum, y, i) => {
    const predicted = slope * xValues[i] + intercept;
    return sum + Math.pow(y - predicted, 2);
  }, 0);
  const ssTot = yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
  const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { slope, intercept, rSquared };
}

/**
 * Calculate weight trend for a specific time period
 */
function calculateWeightTrend(
  data: HealthMetricPoint[],
  periodDays: number,
  periodName: string
): WeightTrend {
  if (data.length < 2) {
    return {
      direction: 'stable',
      rate: 0,
      confidence: 0,
      trendStrength: 'weak',
      period: periodName,
      insights: ['Insufficient data for trend analysis'],
    };
  }

  const regression = calculateLinearRegression(data);
  const daysInPeriod = periodDays;
  const ratePerWeek = (regression.slope * daysInPeriod) / 7; // Convert to weekly rate
  
  // Determine direction
  let direction: WeightTrend['direction'];
  const absRate = Math.abs(ratePerWeek);
  
  if (absRate < 0.1) {
    direction = 'stable';
  } else if (ratePerWeek > 0.5) {
    direction = 'gaining';
  } else if (ratePerWeek < -0.5) {
    direction = 'losing';
  } else {
    direction = 'fluctuating';
  }

  // Calculate confidence based on R-squared and data points
  const confidence = Math.min(regression.rSquared * Math.min(data.length / 7, 1), 1);
  
  // Determine trend strength
  let trendStrength: WeightTrend['trendStrength'];
  if (confidence < 0.3 || absRate < 0.1) {
    trendStrength = 'weak';
  } else if (confidence < 0.7 || absRate < 0.3) {
    trendStrength = 'moderate';
  } else {
    trendStrength = 'strong';
  }

  // Generate insights
  const insights: string[] = [];
  
  if (direction === 'losing' && absRate > 0.5) {
    insights.push(`Healthy weight loss rate of ${Math.abs(ratePerWeek).toFixed(1)} kg/week`);
  } else if (direction === 'gaining' && absRate > 0.5) {
    insights.push(`Weight gain rate of ${ratePerWeek.toFixed(1)} kg/week - consider reviewing diet and exercise`);
  } else if (direction === 'stable') {
    insights.push('Weight is stable - good maintenance of current weight');
  } else if (direction === 'fluctuating') {
    insights.push('Weight is fluctuating - normal variation or inconsistent tracking');
  }

  if (confidence < 0.5) {
    insights.push('Low confidence trend - consider more consistent tracking');
  }

  return {
    direction,
    rate: ratePerWeek,
    confidence,
    trendStrength,
    period: periodName,
    insights,
  };
}

/**
 * Calculate statistical measures for weight data
 */
function calculateStatistics(data: HealthMetricPoint[]): WeightAnalysis['statistics'] {
  if (data.length === 0) {
    return {
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      standardDeviation: 0,
      variance: 0,
    };
  }

  const values = data.map(p => p.value).sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const average = sum / values.length;
  
  const median = values.length % 2 === 0
    ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : values[Math.floor(values.length / 2)];

  const variance = values.reduce((acc, val) => acc + Math.pow(val - average, 2), 0) / values.length;
  const standardDeviation = Math.sqrt(variance);

  return {
    average: Number(average.toFixed(1)),
    median: Number(median.toFixed(1)),
    min: values[0],
    max: values[values.length - 1],
    standardDeviation: Number(standardDeviation.toFixed(1)),
    variance: Number(variance.toFixed(2)),
  };
}

/**
 * Detect weekly patterns in weight data
 */
function detectWeeklyPattern(data: HealthMetricPoint[]): WeeklyPattern | undefined {
  if (data.length < 14) return undefined; // Need at least 2 weeks of data

  const dayAverages = new Map<number, number[]>();
  
  data.forEach(point => {
    const date = new Date(point.date);
    const dayOfWeek = date.getDay();
    
    if (!dayAverages.has(dayOfWeek)) {
      dayAverages.set(dayOfWeek, []);
    }
    dayAverages.get(dayOfWeek)!.push(point.value);
  });

  let maxVariance = 0;
  let significantDay: number | undefined;
  
  for (const [day, values] of dayAverages) {
    if (values.length < 2) continue;
    
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / values.length;
    
    if (variance > maxVariance) {
      maxVariance = variance;
      significantDay = day;
    }
  }

  if (significantDay !== undefined && maxVariance > 0.1) {
    const values = dayAverages.get(significantDay)!;
    const averageWeight = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    return {
      dayOfWeek: significantDay,
      averageWeight: Number(averageWeight.toFixed(1)),
      trend: 'neutral', // Could be enhanced with more sophisticated analysis
      significance: Math.min(maxVariance * 10, 1),
    };
  }

  return undefined;
}

/**
 * Generate weight predictions based on current trend
 */
function generatePredictions(
  data: HealthMetricPoint[],
  trend: WeightTrend,
  days: number = 7
): WeightPrediction[] {
  if (data.length < 2 || trend.confidence < 0.3) {
    return [];
  }

  const regression = calculateLinearRegression(data);
  const predictions: WeightPrediction[] = [];
  const lastDate = Math.max(...data.map(p => p.date));
  const lastWeight = data[data.length - 1].value;

  for (let i = 1; i <= days; i++) {
    const futureDate = lastDate + (i * 24 * 60 * 60 * 1000);
    const predictedWeight = lastWeight + (regression.slope * i);
    const confidence = Math.max(0, trend.confidence - (i * 0.1)); // Decrease confidence over time

    predictions.push({
      date: futureDate,
      predictedWeight: Number(predictedWeight.toFixed(1)),
      confidence: Math.max(0, confidence),
    });
  }

  return predictions;
}

/**
 * Comprehensive weight analysis
 */
export function analyzeWeightTrends(
  data: HealthMetricPoint[],
  goalWeight?: number
): WeightAnalysis {
  if (data.length === 0) {
    throw new Error('No weight data available for analysis');
  }

  // Sort data by date
  const sortedData = [...data].sort((a, b) => a.date - b.date);
  
  // Get current weight (most recent)
  const current = {
    weight: sortedData[sortedData.length - 1].value,
    timestamp: sortedData[sortedData.length - 1].date,
  };

  // Calculate trends for different periods
  const shortTermData = sortedData.filter(p => 
    p.date >= (Date.now() - 7 * 24 * 60 * 60 * 1000)
  );
  const mediumTermData = sortedData.filter(p => 
    p.date >= (Date.now() - 30 * 24 * 60 * 60 * 1000)
  );
  const longTermData = sortedData.filter(p => 
    p.date >= (Date.now() - 90 * 24 * 60 * 60 * 1000)
  );

  const shortTerm = calculateWeightTrend(shortTermData, 7, 'last 7 days');
  const mediumTerm = calculateWeightTrend(mediumTermData, 30, 'last 30 days');
  const longTerm = calculateWeightTrend(longTermData, 90, 'last 90 days');

  // Add predictions to short-term trend
  shortTerm.predictions = generatePredictions(shortTermData, shortTerm);

  // Calculate statistics
  const statistics = calculateStatistics(sortedData);

  // Detect patterns
  const patterns = {
    weeklyPattern: detectWeeklyPattern(sortedData),
  };

  // Calculate goal progress
  let goalProgress = 0;
  let estimatedTimeToGoal: number | undefined;
  let recommendations: string[] = [];

  if (goalWeight) {
    const currentTrend = mediumTerm.confidence > shortTerm.confidence ? mediumTerm : shortTerm;
    const weightDifference = Math.abs(current.weight - goalWeight);
    
    if (currentTrend.rate !== 0) {
      const weeksToGoal = weightDifference / Math.abs(currentTrend.rate);
      estimatedTimeToGoal = Math.round(weeksToGoal * 7);
      
      if (currentTrend.direction === 'losing' && current.weight > goalWeight) {
        goalProgress = Math.min(100, ((current.weight - goalWeight) / (current.weight - goalWeight + weightDifference)) * 100);
      } else if (currentTrend.direction === 'gaining' && current.weight < goalWeight) {
        goalProgress = Math.min(100, ((goalWeight - current.weight) / (goalWeight - current.weight + weightDifference)) * 100);
      }
    }

    // Generate recommendations
    if (currentTrend.direction === 'stable' && Math.abs(current.weight - goalWeight) > 1) {
      recommendations.push('Consider adjusting your diet and exercise routine to reach your goal');
    } else if (currentTrend.direction === 'gaining' && current.weight > goalWeight) {
      recommendations.push('Focus on calorie deficit through diet and increased activity');
    } else if (currentTrend.direction === 'losing' && current.weight < goalWeight) {
      recommendations.push('Consider increasing calorie intake and resistance training');
    }
  }

  return {
    current,
    trends: {
      shortTerm,
      mediumTerm,
      longTerm,
    },
    statistics,
    patterns,
    goals: {
      progress: goalProgress,
      estimatedTimeToGoal,
      recommendations,
    },
  };
}

/**
 * Get weight trend summary for quick display
 */
export function getWeightTrendSummary(analysis: WeightAnalysis): {
  primaryTrend: WeightTrend;
  summary: string;
  recommendation: string;
} {
  // Use the most confident trend
  const trends = [analysis.trends.shortTerm, analysis.trends.mediumTerm, analysis.trends.longTerm];
  const primaryTrend = trends.reduce((prev, current) => 
    current.confidence > prev.confidence ? current : prev
  );

  let summary = '';
  let recommendation = '';

  switch (primaryTrend.direction) {
    case 'losing':
      summary = `Losing ${Math.abs(primaryTrend.rate).toFixed(1)} kg/week`;
      recommendation = primaryTrend.rate < -1 ? 'Consider slowing weight loss for sustainability' : 'Healthy weight loss rate';
      break;
    case 'gaining':
      summary = `Gaining ${primaryTrend.rate.toFixed(1)} kg/week`;
      recommendation = primaryTrend.rate > 0.5 ? 'Consider reviewing diet and exercise routine' : 'Moderate weight gain';
      break;
    case 'stable':
      summary = 'Weight is stable';
      recommendation = 'Good weight maintenance';
      break;
    case 'fluctuating':
      summary = 'Weight is fluctuating';
      recommendation = 'Try to track weight at consistent times';
      break;
  }

  return {
    primaryTrend,
    summary,
    recommendation,
  };
}

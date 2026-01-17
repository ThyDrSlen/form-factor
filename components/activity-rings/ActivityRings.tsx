import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { useHealthKit } from '@/contexts/HealthKitContext';
import { useWorkouts } from '@/contexts/WorkoutsContext';
import { useFood } from '@/contexts/FoodContext';
import { useNutritionGoals } from '@/contexts/NutritionGoalsContext';

interface ActivityRingProps {
  progress: number; // 0-1
  size: number;
  strokeWidth: number;
  color: string;
  backgroundColor?: string;
  title: string;
  subtitle: string;
  showValue?: boolean;
}

function ActivityRing({
  progress,
  size,
  strokeWidth,
  color,
  backgroundColor = '#1B2E4A',
  title,
  subtitle,
  showValue = false
}: ActivityRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (progress * circumference);

  return (
    <View style={styles.ringContainer}>
      <View style={styles.ringContent}>
        <Svg width={size} height={size} style={styles.ring}>
          <Defs>
            <SvgLinearGradient id={`gradient-${color}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={color} stopOpacity={0.8} />
              <Stop offset="100%" stopColor={color} stopOpacity={0.4} />
            </SvgLinearGradient>
          </Defs>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={backgroundColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`url(#gradient-${color})`}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        {showValue && (
          <View style={styles.ringValue}>
            <Text style={styles.ringValueText}>{Math.round(progress * 100)}%</Text>
          </View>
        )}
      </View>
      <Text style={styles.ringTitle}>{title}</Text>
      <Text style={styles.ringSubtitle}>{subtitle}</Text>
    </View>
  );
}

export function ActivityRings() {
  const { stepsToday } = useHealthKit();
  const { workouts } = useWorkouts();
  const { foods } = useFood();
  const { goals: nutritionGoals } = useNutritionGoals();

  const steps = stepsToday || 0;
  const calories = foods
    .filter(f => {
      const today = new Date();
      const foodDate = new Date(f.date);
      return foodDate.toDateString() === today.toDateString();
    })
    .reduce((sum, f) => sum + (f.calories || 0), 0);

  const exerciseMinutes = workouts
    .filter(w => {
      const today = new Date();
      const workoutDate = new Date(w.date);
      return workoutDate.toDateString() === today.toDateString();
    })
    .reduce((sum, w) => sum + (w.duration || 0), 0);

  const goals = {
    steps: 8000,
    calories: nutritionGoals?.calories || 2000,
    exerciseMinutes: 30,
  };

  const stepProgress = Math.min(steps / goals.steps, 1);
  const calorieProgress = Math.min(calories / goals.calories, 1);
  const exerciseProgress = Math.min(exerciseMinutes / goals.exerciseMinutes, 1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today&#39;s Activity</Text>
      <View style={styles.ringsContainer}>
        <ActivityRing
          progress={stepProgress}
          size={120}
          strokeWidth={8}
          color="#4C8CFF"
          title="Steps"
          subtitle={`${steps.toLocaleString()} / ${goals.steps.toLocaleString()}`}
          showValue={true}
        />
        <ActivityRing
          progress={calorieProgress}
          size={120}
          strokeWidth={8}
          color="#FF6B6B"
          title="Calories"
          subtitle={`${calories} / ${goals.calories}`}
          showValue={true}
        />
        <ActivityRing
          progress={exerciseProgress}
          size={120}
          strokeWidth={8}
          color="#34C759"
          title="Exercise"
          subtitle={`${exerciseMinutes} / ${goals.exerciseMinutes} min`}
          showValue={true}
        />
      </View>

      {/* Summary Card */}
      <LinearGradient
        colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.summaryCard}
      >
        <Text style={styles.summaryTitle}>Daily Goals Progress</Text>
        <View style={styles.summaryStats}>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, { color: stepProgress >= 1 ? '#34C759' : '#4C8CFF' }]}>
              {Math.round(stepProgress * 100)}%
            </Text>
            <Text style={styles.summaryLabel}>Steps Goal</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, { color: calorieProgress >= 1 ? '#34C759' : '#FF6B6B' }]}>
              {Math.round(calorieProgress * 100)}%
            </Text>
            <Text style={styles.summaryLabel}>Calorie Goal</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, { color: exerciseProgress >= 1 ? '#34C759' : '#34C759' }]}>
              {Math.round(exerciseProgress * 100)}%
            </Text>
            <Text style={styles.summaryLabel}>Exercise Goal</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 20,
    textAlign: 'center',
  },
  ringsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 24,
  },
  ringContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringContent: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'relative',
  },
  ringValue: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValueText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F5F7FF',
  },
  ringTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    marginTop: 8,
    textAlign: 'center',
  },
  ringSubtitle: {
    fontSize: 12,
    color: '#9AACD1',
    marginTop: 2,
    textAlign: 'center',
  },
  summaryCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
    textAlign: 'center',
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryStat: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#9AACD1',
    textAlign: 'center',
  },
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NutritionFormCorrelationCard } from '@/components/form-home/NutritionFormCorrelationCard';
import type { NutritionFormCorrelation } from '@/lib/services/form-nutrition-correlator';

function mkMetric(significance: 'low' | 'medium' | 'high', r = 0.6) {
  return {
    r,
    slope: 0.5,
    r2: r * r,
    sampleCount: 20,
    significance,
  };
}

describe('NutritionFormCorrelationCard', () => {
  it('renders loading state', () => {
    const { getByTestId } = render(
      <NutritionFormCorrelationCard data={null} loading />,
    );
    expect(getByTestId('nutrition-correlation-loading')).toBeTruthy();
  });

  it('renders empty state when data is null', () => {
    const { getByTestId } = render(
      <NutritionFormCorrelationCard data={null} />,
    );
    expect(getByTestId('nutrition-correlation-empty')).toBeTruthy();
  });

  it('renders empty state when sampleCount is 0', () => {
    const data: NutritionFormCorrelation = {
      windowHours: 3,
      proteinVsFqi: mkMetric('low', 0),
      carbsVsFqi: mkMetric('low', 0),
      caloriesVsFqi: mkMetric('low', 0),
      mealProximityMinVsFqi: mkMetric('low', 0),
      insights: [],
      sampleCount: 0,
    };
    const { getByTestId } = render(
      <NutritionFormCorrelationCard data={data} />,
    );
    expect(getByTestId('nutrition-correlation-empty')).toBeTruthy();
  });

  it('ranks the top insight by significance + |r| and opens detail modal', () => {
    const data: NutritionFormCorrelation = {
      windowHours: 3,
      proteinVsFqi: mkMetric('high', 0.7),
      carbsVsFqi: mkMetric('low', 0.1),
      caloriesVsFqi: mkMetric('medium', 0.4),
      mealProximityMinVsFqi: mkMetric('low', -0.05),
      insights: [
        {
          id: 'protein_high',
          title: 'Protein × form',
          description: 'big lift',
          metric: mkMetric('high', 0.7),
        },
        {
          id: 'carb_timing',
          title: 'Carb timing × form',
          description: 'meh',
          metric: mkMetric('low', 0.1),
        },
        {
          id: 'meal_proximity',
          title: 'Meal proximity × form',
          description: 'tiny',
          metric: mkMetric('low', -0.05),
        },
      ],
      sampleCount: 20,
    };
    const { getByText, getByTestId } = render(
      <NutritionFormCorrelationCard data={data} />,
    );
    expect(getByTestId('nutrition-correlation-card')).toBeTruthy();
    expect(getByText('Protein × form')).toBeTruthy();
    fireEvent.press(getByTestId('nutrition-correlation-learn-more'));
    expect(getByTestId('nutrition-correlation-detail-protein_high')).toBeTruthy();
    expect(getByTestId('nutrition-correlation-detail-carb_timing')).toBeTruthy();
    fireEvent.press(getByTestId('nutrition-correlation-detail-close'));
  });
});

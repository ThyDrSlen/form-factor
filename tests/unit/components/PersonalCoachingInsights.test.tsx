import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PersonalCoachingInsights } from '@/features/health/components/PersonalCoachingInsights';
import { learnPersonalForm, rateHypertrophyTraining } from '@/lib/services/personalized-coaching';

let mockState: any;
jest.mock('@/features/health/hooks/use-personal-coaching-insights', () => ({ usePersonalCoachingInsights: () => mockState }));
beforeEach(() => {
  mockState = { signedIn: true, loading: false, error: null, refresh: jest.fn(), data: { learning: learnPersonalForm([]), training: rateHypertrophyTraining([]), sessionCount: 0 } };
});
it('labels sparse, rule-based and unknown results without a fabricated health score', () => {
  const screen = render(<PersonalCoachingInsights />);
  expect(screen.getByText(/Not enough paired history/)).toBeTruthy();
  expect(screen.getByText(/Rule-based rep-range support: unknown/)).toBeTruthy();
  expect(screen.getByText(/not a muscle-growth measurement/)).toBeTruthy();
  expect(screen.getByText(/Sleep, HRV and physiological recovery are not inferred/)).toBeTruthy();
  expect(screen.getByText(/separate UTC calendar days/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Refresh personal insights' }));
  expect(mockState.refresh).toHaveBeenCalledTimes(1);
});
it('shows honest loading, error/retry and signed-out states', () => {
  mockState.loading = true;
  const screen = render(<PersonalCoachingInsights />);
  expect(screen.getByText(/Learning from your existing records/)).toBeTruthy();
  mockState = { ...mockState, loading: false, error: 'Unavailable', data: null };
  screen.rerender(<PersonalCoachingInsights />);
  expect(screen.getByText('Unavailable')).toBeTruthy();
  mockState.signedIn = false;
  screen.rerender(<PersonalCoachingInsights />);
  expect(screen.getByText(/Sign in to view/)).toBeTruthy();
});
it('displays validation errors and tentative association, never a causal prescription', () => {
  mockState.data.learning = learnPersonalForm(Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, exercise: 'squat', startAt: (i + 1) * 86400000, endAt: (i + 1) * 86400000 + 1, restHours: 24 + i % 4 * 12, fqi: 50 + i % 4 * 10 })));
  const screen = render(<PersonalCoachingInsights />);
  expect(screen.getByText(/Tentative association/)).toBeTruthy();
  expect(screen.getByText(/12 later sessions/)).toBeTruthy();
  expect(screen.getByText(/Not causal/)).toBeTruthy();
});

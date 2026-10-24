import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { HealthInsightsExtras } from '@/features/health/components/HealthInsightsExtras';
const mockContextPanel = jest.fn((props: unknown) => { void props; return null; });
const mockStepHistory = jest.fn().mockResolvedValue([]);
jest.mock('@/lib/services/healthkit/health-metrics', () => ({getStepHistoryAsync:(days: number) => mockStepHistory(days)}));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({user:{id:'owner'}}) }));
jest.mock('@/features/health/contexts/HealthKitContext', () => ({ useHealthKit: () => ({
 isAvailable:true,
 recordedWeightHistory:[{dayKey:'2026-10-01',date:1,value:75,unit:'kg',source:'HealthKit',provenance:'observed'}],
 stepHistory:[{date:Date.UTC(2026,9,1),value:1234},{date:Date.UTC(2026,9,2),value:0}],
}) }));
jest.mock('@/features/health/components/TrendContextPanel', () => ({ TrendContextPanel:(props: unknown) => mockContextPanel(props) }));
jest.mock('@/features/health/components/PersonalCoachingInsights', () => ({ PersonalCoachingInsights: () => null }));
jest.mock('@/features/health/components/BodyCompositionCard', () => ({ BodyCompositionCard: () => null }));
beforeEach(() => jest.clearAllMocks());
it('keeps privacy detail on demand and exposes an explicit accessible accordion label', () => {
 const view = render(<HealthInsightsExtras />);
 expect(view.queryByText(/Health readings come from this device/)).toBeNull();
 fireEvent.press(view.getByRole('button', {name:'Data & privacy'}));
 expect(view.getByText(/Health readings come from this device/)).toBeTruthy();
 fireEvent.press(view.getByRole('button', {name:'Recovery & training'}));
 expect(view.getByRole('button', {name:'Recovery & training'}).props.accessibilityState.expanded).toBe(true);
 fireEvent.press(view.getByRole('button', {name:'Body composition'}));
 expect(view.getByRole('button', {name:'Recovery & training'}).props.accessibilityState.expanded).toBe(false);
});
it('wires recorded readings into context without counting filled steps as observations', async () => {
 const view = render(<HealthInsightsExtras />);
 expect(mockContextPanel).not.toHaveBeenCalled();
 expect(mockStepHistory).not.toHaveBeenCalled();
 fireEvent.press(view.getByText(/^Trips & routine changes/));
 const props=mockContextPanel.mock.calls[0][0] as any;
 expect(props.ownerId).toBe('owner');
 expect(props.weightObservations).toEqual([{date:'2026-10-01',value:75,unit:'kg',source:'HealthKit',observed:true}]);
 expect(props.stepObservations).toEqual([{date:'2026-10-01',value:1234,unit:'steps',source:'HealthKit daily totals',observed:true}]);
 await waitFor(() => expect(mockStepHistory).toHaveBeenCalledWith(180));
});

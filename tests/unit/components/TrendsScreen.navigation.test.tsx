import React from 'react';

import { render, fireEvent } from '@testing-library/react-native';
import TrendsScreen from '@/app/(tabs)/trends';
jest.mock('@/features/health/components/HealthTrendsView', () => ({ HealthTrendsView: () => { const {Text} = require('react-native'); return <Text>Metric overview</Text>; } }));
jest.mock('@/features/health/components/HealthInsightsExtras', () => ({ HealthInsightsExtras: () => { const {Text, TextInput, View} = require('react-native'); const [draft, setDraft] = require('react').useState(''); return <View><Text>Explore insights</Text><TextInput accessibilityLabel="Draft note" value={draft} onChangeText={setDraft} /></View>; } }));
it('retains an insight draft when switching sections', () => {
 const view = render(<TrendsScreen />);
 fireEvent.press(view.getByRole('tab', {name:'Insights'}));
 fireEvent.changeText(view.getByLabelText('Draft note'), 'Vacation context');
 fireEvent.press(view.getByRole('tab', {name:'Overview'}));
 fireEvent.press(view.getByRole('tab', {name:'Insights'}));
 expect(view.getByDisplayValue('Vacation context')).toBeTruthy();
});
it('offers direct access to insights without scrolling through every metric', () => {
 const view = render(<TrendsScreen />);
 expect(view.getByText('Metric overview')).toBeTruthy();
 expect(view.queryByText('Explore insights')).toBeNull();
 fireEvent.press(view.getByRole('tab', {name:'Insights'}));
 expect(view.getByText('Explore insights')).toBeTruthy();
 expect(view.queryByText('Metric overview')).toBeNull();
 expect(view.getByRole('tab', {name:'Insights'}).props.accessibilityState.selected).toBe(true);
 fireEvent.press(view.getByRole('tab', {name:'Overview'}));
 expect(view.getByText('Metric overview')).toBeTruthy();
});

import React from 'react';
import { fireEvent, render, waitFor, waitForElementToBeRemoved } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrendContextPanel } from '@/features/health/components/TrendContextPanel';

beforeEach(async () => { await AsyncStorage.clear(); });
describe('TrendContextPanel', () => {
  it('adds an optional local tag with labeled manual fields and shows honest missing coverage; deletes it', async () => {
    const view = render(<TrendContextPanel ownerId="a" weightObservations={[]} stepObservations={[]} />);
    await waitFor(() => expect(view.getByRole('button', { name: 'Save context' })).not.toBeDisabled());
    fireEvent.press(view.getByRole('button', { name: 'Travel' }));
    fireEvent.changeText(view.getByLabelText('Start date (YYYY-MM-DD)'), '2020-01-01');
    fireEvent.changeText(view.getByLabelText('End date (YYYY-MM-DD)'), '2020-01-03');
    fireEvent.changeText(view.getByLabelText('City (optional)'), 'Kyoto');
    fireEvent.press(view.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(view.getByText('Travel · Kyoto')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Compare Travel 2020-01-01 to 2020-01-03' }));
    expect(view.getAllByText(/0\/3 recorded days/)).toHaveLength(6);
    expect(view.getByText(/not evidence that the tagged event caused/)).toBeTruthy();
    expect(view.getAllByText(/originating device or scale is unknown/)).toHaveLength(2);
    fireEvent.press(view.getByRole('button', { name: 'Delete Travel 2020-01-01 to 2020-01-03' }));
    // A failing toBeNull() pretty-prints the fiber (~0.5s per poll), which can outlast waitFor's 1s budget on CI.
    await waitForElementToBeRemoved(() => view.queryByText('Travel · Kyoto'));
  });
  it('clears unsaved private fields on account change and disables signed-out editing', async () => {
    const view = render(<TrendContextPanel ownerId="a" />);
    fireEvent.changeText(view.getByLabelText('City (optional)'), 'Private city');
    view.rerender(<TrendContextPanel ownerId="b" />);
    expect(view.getByLabelText('City (optional)').props.value).toBe('');
    view.rerender(<TrendContextPanel ownerId={null} />);
    expect(view.queryByLabelText('City (optional)')).toBeNull();
    expect(view.getByText(/Sign in/)).toBeTruthy();
  });
});

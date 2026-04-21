/**
 * Rep-insights export retry UI (GAP-6).
 *
 * Verifies that when `shareRepData` throws, the modal surfaces an
 * inline error banner with Retry + Dismiss rather than an Alert, and
 * that Retry re-invokes the exporter with the same format.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockShareRepData = jest.fn();
const mockRouterBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockRouterBack, push: jest.fn() }),
  useLocalSearchParams: () => ({ sessionId: 'session-1' }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/lib/services/rep-export', () => ({
  shareRepData: (...args: unknown[]) => mockShareRepData(...args),
}));

// Rep-insights now surfaces export failures via both the inline banner and
// a Toast. These tests target the banner UI, so a cheap useToast mock keeps
// them isolated from the ToastProvider tree.
jest.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

// Stub heavy insight widgets so the test only exercises the export card.
jest.mock('@/components/insights/FqiTrendChart', () => ({
  FqiTrendChart: () => null,
}));
jest.mock('@/components/insights/FaultHeatmap', () => ({
  FaultHeatmap: () => null,
}));
jest.mock('@/components/insights/RomProgressionCard', () => ({
  RomProgressionCard: () => null,
}));
jest.mock('@/components/insights/SymmetryCard', () => ({
  SymmetryCard: () => null,
}));
jest.mock('@/components/insights/RepRewindCarousel', () => ({
  RepRewindCarousel: () => null,
}));

// eslint-disable-next-line import/first
import RepInsightsModal from '../../../app/(modals)/rep-insights';

describe('RepInsightsModal — export retry UI', () => {
  beforeEach(() => {
    mockShareRepData.mockReset();
  });

  it('surfaces an error banner with Retry when shareRepData throws', async () => {
    mockShareRepData.mockRejectedValueOnce(new Error('Network error'));

    const { getByText, getByTestId, queryByTestId } = render(<RepInsightsModal />);
    expect(queryByTestId('rep-export-error-banner')).toBeNull();

    fireEvent.press(getByText('CSV'));

    await waitFor(() => {
      expect(getByTestId('rep-export-error-banner')).toBeTruthy();
    });
    expect(getByTestId('rep-export-error-message')).toBeTruthy();
    expect(getByText('CSV export failed')).toBeTruthy();
    expect(getByTestId('rep-export-retry-button')).toBeTruthy();
  });

  it('retries with the same format when the user presses Retry', async () => {
    mockShareRepData
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({ shared: true, fileUri: '/tmp/out.csv', payload: '', filename: 'out.csv', mimeType: 'text/csv' });

    const { getByText, getByTestId, queryByTestId } = render(<RepInsightsModal />);
    fireEvent.press(getByText('CSV'));

    await waitFor(() => {
      expect(getByTestId('rep-export-error-banner')).toBeTruthy();
    });

    fireEvent.press(getByTestId('rep-export-retry-button'));

    await waitFor(() => {
      expect(queryByTestId('rep-export-error-banner')).toBeNull();
    });
    // Both calls should target csv, not json.
    expect(mockShareRepData).toHaveBeenCalledTimes(2);
    expect(mockShareRepData.mock.calls[0][1]).toBe('csv');
    expect(mockShareRepData.mock.calls[1][1]).toBe('csv');
  });

  it('clears the banner when Dismiss is pressed', async () => {
    mockShareRepData.mockRejectedValueOnce(new Error('boom'));

    const { getByText, getByTestId, queryByTestId } = render(<RepInsightsModal />);
    fireEvent.press(getByText('JSON'));

    await waitFor(() => {
      expect(getByTestId('rep-export-error-banner')).toBeTruthy();
    });

    fireEvent.press(getByTestId('rep-export-dismiss-button'));
    expect(queryByTestId('rep-export-error-banner')).toBeNull();
  });

  it('keeps the original error text accessible on the banner', async () => {
    mockShareRepData.mockRejectedValueOnce(new Error('Device storage full'));

    const { getByText, findByTestId } = render(<RepInsightsModal />);
    fireEvent.press(getByText('CSV'));

    const message = await findByTestId('rep-export-error-message');
    // The full error should remain visible in the banner — tests against
    // regressions where only a generic "Export failed" label is shown.
    expect(message).toBeTruthy();
    expect((message.props.children as string)).toContain('Device storage full');
  });
});

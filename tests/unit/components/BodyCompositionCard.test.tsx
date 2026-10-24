import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { BodyCompositionCard } from '@/features/health/components/BodyCompositionCard';
import { readBodyFatHistory } from '@/lib/services/healthkit/body-composition';
jest.mock('@/lib/services/healthkit/body-composition', () => ({ readBodyFatHistory: jest.fn() }));
describe('body composition consent card', () => {
  beforeEach(() => jest.clearAllMocks());
  it('ignores an old account read that resolves after switching owners', async () => {
    let resolve!: (value: {date: number; value: number}[]) => void;
    (readBodyFatHistory as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<BodyCompositionCard ownerId="a" />);
    fireEvent.press(view.getByText('Read body-fat history'));
    view.rerender(<BodyCompositionCard ownerId="b" />);
    await act(async () => { resolve([{date: Date.now(), value:18}]); });
    expect(view.queryByText('18.0%')).toBeNull();
  });
  it('does not request health access until explicitly pressed', async () => {
    (readBodyFatHistory as jest.Mock).mockResolvedValue([{date: Date.parse('2026-10-01T12:00:00Z'), value:18}]);
    const view = render(<BodyCompositionCard ownerId="a" />);
    expect(readBodyFatHistory).not.toHaveBeenCalled();
    fireEvent.press(view.getByText('Read body-fat history'));
    await waitFor(() => expect(view.getByText('18.0%')).toBeTruthy());
    view.rerender(<BodyCompositionCard ownerId="b" />);
    expect(view.queryByText('18.0%')).toBeNull();
  });
});

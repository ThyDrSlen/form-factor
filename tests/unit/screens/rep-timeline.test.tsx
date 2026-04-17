import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import RepTimelineScreen from '@/app/(modals)/rep-timeline';
import {
  defaultRepQualityLog,
  type RepQualityEntry,
} from '@/lib/services/rep-quality-log';

const mockRouter = {
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};

let mockSearchParams: { sessionId?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => {
    const { View } = jest.requireActual('react-native');
    return <View {...props}>{children}</View>;
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>icon:{name}</Text>;
  },
}));

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 'session-x',
    repIndex: partial.repIndex ?? 1,
    exercise: 'squat',
    ts: `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 80,
    faults: [],
    ...partial,
  };
}

describe('RepTimelineScreen', () => {
  beforeEach(() => {
    mockSearchParams = {};
    mockRouter.back.mockReset();
    mockRouter.replace.mockReset();
    mockRouter.canGoBack.mockReset().mockReturnValue(true);
    defaultRepQualityLog.clear();
  });

  it('shows a missing-session message when the sessionId param is absent', () => {
    const { getByText } = render(<RepTimelineScreen />);
    expect(getByText('Missing session')).toBeTruthy();
  });

  it('renders the rep timeline card when a sessionId is provided', () => {
    mockSearchParams = { sessionId: 'session-x' };
    defaultRepQualityLog.append(mkEntry({ repIndex: 1, fqi: 80 }));
    defaultRepQualityLog.append(mkEntry({ repIndex: 2, fqi: 90 }));
    const { getByTestId, getAllByText } = render(<RepTimelineScreen />);
    expect(getByTestId('rep-timeline-card')).toBeTruthy();
    expect(getAllByText(/2 reps/).length).toBeGreaterThan(0);
  });

  it('renders the empty-state caption inside the card when the session has no entries', () => {
    mockSearchParams = { sessionId: 'session-empty' };
    const { getByText } = render(<RepTimelineScreen />);
    expect(getByText('No reps recorded yet.')).toBeTruthy();
  });

  it('updates when the log receives new entries', () => {
    mockSearchParams = { sessionId: 'session-x' };
    const { getAllByText, queryAllByText, rerender } = render(<RepTimelineScreen />);
    // Card subtitle hides the "N reps" suffix when empty; only the empty-state label shows.
    expect(queryAllByText(/\d+ reps/)).toHaveLength(0);
    act(() => {
      defaultRepQualityLog.append(mkEntry({ repIndex: 1 }));
    });
    rerender(<RepTimelineScreen />);
    expect(getAllByText(/1 reps/).length).toBeGreaterThan(0);
  });

  it('navigates back when the close button is pressed and canGoBack is true', () => {
    mockSearchParams = { sessionId: 'session-x' };
    const { getByLabelText } = render(<RepTimelineScreen />);
    fireEvent.press(getByLabelText('Close rep timeline'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('falls back to replace("/") when there is no navigation stack', () => {
    mockSearchParams = { sessionId: 'session-x' };
    mockRouter.canGoBack.mockReturnValue(false);
    const { getByLabelText } = render(<RepTimelineScreen />);
    fireEvent.press(getByLabelText('Close rep timeline'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});

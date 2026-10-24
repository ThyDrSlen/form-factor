import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockUseFirstSessionCheck = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

jest.mock('@/features/form-tracking/hooks/use-first-session-check', () => ({
  useFirstSessionCheck: (...args: unknown[]) => mockUseFirstSessionCheck(...args),
}));

import { StartSessionCta } from '@/features/form-tracking/components/home/StartSessionCta';

describe('StartSessionCta', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockUseFirstSessionCheck.mockReturnValue({ hasSeenSetup: false, markSeen: jest.fn() });
  });

  it('renders the Analyze form label, accessible name, and icon', () => {
    const { getByText, getByTestId, getByLabelText } = render(<StartSessionCta />);
    expect(getByTestId('start-session-cta')).toBeTruthy();
    expect(getByText('Analyze form')).toBeTruthy();
    expect(getByLabelText('Analyze form')).toBeTruthy();
    expect(getByText('scan-outline')).toBeTruthy();
  });

  it('navigates to setup when the user has not completed form tracking setup', () => {
    const { getByTestId } = render(<StartSessionCta />);
    fireEvent.press(getByTestId('start-session-cta'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/form-tracking-setup');
  });

  it('navigates directly to scan-arkit after setup has been completed', () => {
    mockUseFirstSessionCheck.mockReturnValue({ hasSeenSetup: true, markSeen: jest.fn() });
    const { getByTestId } = render(<StartSessionCta />);
    fireEvent.press(getByTestId('start-session-cta'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/scan-arkit');
  });

  it('waits for setup status before routing', () => {
    mockUseFirstSessionCheck.mockReturnValue({ hasSeenSetup: null, markSeen: jest.fn() });
    const { getByTestId, getByText } = render(<StartSessionCta />);
    expect(getByText('Checking setup status...')).toBeTruthy();
    fireEvent.press(getByTestId('start-session-cta'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('invokes onPress override if provided', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<StartSessionCta onPress={onPress} />);
    fireEvent.press(getByTestId('start-session-cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { CoachProvider } from '@/lib/services/coach-provider-types';

const mockSendCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

jest.mock('@/lib/services/coach-history-service', () => ({
  fetchTodaySession: jest.fn().mockResolvedValue(null),
  fetchCoachSessionMessages: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'u@example.com' } }),
}));

jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-session',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/use-voice-mode', () => ({
  useVoiceMode: () => ({
    isListening: false,
    transcript: '',
    startVoiceMode: jest.fn(),
    stopVoiceMode: jest.fn(),
    playResponse: jest.fn(),
  }),
}));

import CoachScreen from '../../../app/(tabs)/coach';

function assistantReply(
  content: string,
  provider: CoachProvider
): { role: 'assistant'; content: string; provider: CoachProvider } {
  return { role: 'assistant', content, provider };
}

describe('CoachScreen — provider badge integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each<[CoachProvider, string, string]>([
    ['openai', 'Use a hip hinge.', 'GPT'],
    ['gemma-cloud', 'Breathe into belly.', 'Gemma'],
    ['gemma-on-device', 'Keep chest up.', 'Gemma • on device'],
    ['local-fallback', 'Offline plan.', 'Local fallback'],
    ['cached', 'Deja vu reply.', 'From cache'],
  ])(
    'renders %s badge under assistant bubbles',
    async (provider, content, expectedLabel) => {
      mockSendCoachPrompt.mockResolvedValueOnce(assistantReply(content, provider));

      const { getByText, findByTestId, findByText } = render(<CoachScreen />);

      // Wait for the mounted-effect sessionLoading cycle to settle so the
      // FlatList is mounted instead of the ActivityIndicator placeholder.
      await waitFor(() => {
        expect(
          getByText('Plan a 75-minute strength session for today.')
        ).toBeTruthy();
      });

      // Fire a quick-prompt to trigger sendCoachPrompt.
      fireEvent.press(getByText('Plan a 75-minute strength session for today.'));

      await waitFor(() => {
        expect(mockSendCoachPrompt).toHaveBeenCalled();
      });

      const badge = await findByTestId(`coach-provider-badge-${provider}`);
      expect(badge).toBeTruthy();

      const labelNode = await findByText(expectedLabel);
      expect(labelNode).toBeTruthy();
    }
  );

  it('does NOT render a badge on the intro (no provider) message', async () => {
    const { queryByTestId, findByText } = render(<CoachScreen />);
    await findByText('Plan a 75-minute strength session for today.');

    expect(queryByTestId('coach-provider-badge-openai')).toBeNull();
    expect(queryByTestId('coach-provider-badge-gemma-cloud')).toBeNull();
    expect(queryByTestId('coach-provider-badge-local-fallback')).toBeNull();
    expect(queryByTestId('coach-provider-badge-cached')).toBeNull();
  });

  it('renders exactly one badge (on the assistant reply, not the user bubble)', async () => {
    mockSendCoachPrompt.mockResolvedValueOnce(assistantReply('Got it.', 'openai'));

    const { getByText, findAllByTestId } = render(<CoachScreen />);

    await waitFor(() => {
      expect(
        getByText('Plan a 75-minute strength session for today.')
      ).toBeTruthy();
    });

    fireEvent.press(getByText('Plan a 75-minute strength session for today.'));

    const badges = await findAllByTestId('coach-provider-badge-openai');
    expect(badges).toHaveLength(1);
  });
});

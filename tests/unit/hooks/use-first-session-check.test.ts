import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  FIRST_SESSION_STORAGE_KEY,
  useFirstSessionCheck,
} from '@/hooks/use-first-session-check';

describe('useFirstSessionCheck', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('starts with hasSeenSetup === null before the initial read completes', () => {
    const { result } = renderHook(() => useFirstSessionCheck());
    expect(result.current.hasSeenSetup).toBeNull();
  });

  it('resolves to false when the storage key is absent', async () => {
    const { result } = renderHook(() => useFirstSessionCheck());

    await waitFor(() => {
      expect(result.current.hasSeenSetup).toBe(false);
    });
  });

  it('resolves to true when the storage key is already set', async () => {
    await AsyncStorage.setItem(FIRST_SESSION_STORAGE_KEY, 'true');

    const { result } = renderHook(() => useFirstSessionCheck());

    await waitFor(() => {
      expect(result.current.hasSeenSetup).toBe(true);
    });
  });

  it('flips hasSeenSetup to true after markSeen and persists the flag', async () => {
    const { result } = renderHook(() => useFirstSessionCheck());

    await waitFor(() => {
      expect(result.current.hasSeenSetup).toBe(false);
    });

    await act(async () => {
      await result.current.markSeen();
    });

    expect(result.current.hasSeenSetup).toBe(true);
    await expect(
      AsyncStorage.getItem(FIRST_SESSION_STORAGE_KEY)
    ).resolves.toBe('true');
  });

  it('falls back to false and warns when AsyncStorage.getItem throws', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const getItemSpy = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useFirstSessionCheck());

    await waitFor(() => {
      expect(result.current.hasSeenSetup).toBe(false);
    });

    expect(warnSpy).toHaveBeenCalled();

    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('still flips local state to true when setItem throws', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));

    const { result } = renderHook(() => useFirstSessionCheck());

    await waitFor(() => {
      expect(result.current.hasSeenSetup).toBe(false);
    });

    await act(async () => {
      await result.current.markSeen();
    });

    expect(result.current.hasSeenSetup).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

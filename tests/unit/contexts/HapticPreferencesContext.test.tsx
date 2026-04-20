import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  HapticPreferencesProvider,
  useHapticPreferences,
} from '@/contexts/HapticPreferencesContext';
import { hapticBus } from '@/lib/haptics/haptic-bus';

function wrapper({ children }: { children: React.ReactNode }) {
  return <HapticPreferencesProvider>{children}</HapticPreferencesProvider>;
}

describe('HapticPreferencesContext', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    hapticBus._reset();
  });

  it('loads persisted prefs and mirrors them into the bus', async () => {
    await AsyncStorage.setItem(
      'ff:haptic-preferences:v1',
      JSON.stringify({
        enabled: false,
        mode: 'critical-only',
        toneOnly: true,
        colorBlindMode: 'deuteranopia',
      }),
    );

    const { result } = renderHook(() => useHapticPreferences(), { wrapper });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.enabled).toBe(false);
    expect(result.current.mode).toBe('critical-only');
    expect(result.current.toneOnly).toBe(true);
    expect(result.current.colorBlindMode).toBe('deuteranopia');
    expect(hapticBus.isEnabled()).toBe(false);
    expect(hapticBus.getMode()).toBe('critical-only');
  });

  it('persists updates through setEnabled / setMode / setToneOnly / setColorBlindMode', async () => {
    const { result } = renderHook(() => useHapticPreferences(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setEnabled(false);
    });
    await act(async () => {
      await result.current.setMode('critical-only');
    });
    await act(async () => {
      await result.current.setToneOnly(true);
    });
    await act(async () => {
      await result.current.setColorBlindMode('protanopia');
    });

    const raw = await AsyncStorage.getItem('ff:haptic-preferences:v1');
    expect(JSON.parse(raw as string)).toEqual({
      enabled: false,
      mode: 'critical-only',
      toneOnly: true,
      colorBlindMode: 'protanopia',
    });
  });

  it('falls back to safe defaults when used outside the provider', () => {
    const { result } = renderHook(() => useHapticPreferences());
    expect(result.current.enabled).toBe(true);
    expect(result.current.mode).toBe('all');
    expect(result.current.toneOnly).toBe(false);
    expect(result.current.colorBlindMode).toBe('off');
  });
});

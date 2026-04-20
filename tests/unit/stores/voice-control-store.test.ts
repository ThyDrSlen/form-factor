/**
 * Tests for lib/stores/voice-control-store.ts
 *
 * The store uses Zustand's `persist` middleware + AsyncStorage. In the
 * jest environment AsyncStorage is mocked globally by tests/setup.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useVoiceControlStore,
  __resetVoiceControlStoreForTests,
  type WakeWordMode,
} from '@/lib/stores/voice-control-store';

beforeEach(async () => {
  __resetVoiceControlStoreForTests();
  await AsyncStorage.clear();
});

describe('useVoiceControlStore — defaults', () => {
  it('starts with enabled=false', () => {
    expect(useVoiceControlStore.getState().enabled).toBe(false);
  });
  it('starts with wakeWordMode="hey-form"', () => {
    expect(useVoiceControlStore.getState().wakeWordMode).toBe('hey-form');
  });
  it('starts with voiceSessionPaused=false', () => {
    expect(useVoiceControlStore.getState().voiceSessionPaused).toBe(false);
  });
});

describe('setEnabled', () => {
  it('toggles the enabled flag', () => {
    useVoiceControlStore.getState().setEnabled(true);
    expect(useVoiceControlStore.getState().enabled).toBe(true);
    useVoiceControlStore.getState().setEnabled(false);
    expect(useVoiceControlStore.getState().enabled).toBe(false);
  });
});

describe('setWakeWordMode', () => {
  it('updates wakeWordMode', () => {
    useVoiceControlStore.getState().setWakeWordMode('coach');
    expect(useVoiceControlStore.getState().wakeWordMode).toBe('coach');
  });
  it('accepts "disabled" mode', () => {
    useVoiceControlStore.getState().setWakeWordMode('disabled');
    expect(useVoiceControlStore.getState().wakeWordMode).toBe('disabled');
  });
});

describe('setVoicePaused', () => {
  it('updates the runtime paused flag', () => {
    useVoiceControlStore.getState().setVoicePaused(true);
    expect(useVoiceControlStore.getState().voiceSessionPaused).toBe(true);
  });
});

describe('resetRuntime', () => {
  it('clears voiceSessionPaused without touching preferences', () => {
    useVoiceControlStore.getState().setEnabled(true);
    useVoiceControlStore.getState().setWakeWordMode('coach');
    useVoiceControlStore.getState().setVoicePaused(true);

    useVoiceControlStore.getState().resetRuntime();

    expect(useVoiceControlStore.getState().voiceSessionPaused).toBe(false);
    expect(useVoiceControlStore.getState().enabled).toBe(true);
    expect(useVoiceControlStore.getState().wakeWordMode).toBe('coach');
  });
});

describe('AsyncStorage persistence', () => {
  it('writes enabled=true to AsyncStorage', async () => {
    useVoiceControlStore.getState().setEnabled(true);
    // Zustand persist writes async; give it a tick.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const stored = await AsyncStorage.getItem('ff.voiceControl');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.state.enabled).toBe(true);
  });

  it('writes wakeWordMode and omits voiceSessionPaused', async () => {
    useVoiceControlStore.getState().setWakeWordMode('coach' as WakeWordMode);
    useVoiceControlStore.getState().setVoicePaused(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const stored = await AsyncStorage.getItem('ff.voiceControl');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.state.wakeWordMode).toBe('coach');
    // partialize should have excluded the runtime flag
    expect(parsed.state.voiceSessionPaused).toBeUndefined();
  });
});

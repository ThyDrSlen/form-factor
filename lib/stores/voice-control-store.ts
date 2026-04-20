/**
 * Voice Control Store (#469)
 *
 * Zustand store holding the user-facing voice feature flag + runtime state.
 * Persists `enabled` + `wakeWordMode` to AsyncStorage under the key
 * `ff.voiceControl`. Ephemeral fields (like `voiceSessionPaused`) stay in
 * memory.
 *
 * Why a Zustand store (not React Context)?
 *   - #433 owns `app/_layout.tsx` — adding a new Provider there would
 *     conflict. A Zustand store can be consumed from any component/hook
 *     without touching the root layout.
 *   - AsyncStorage persistence comes free via `zustand/middleware`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type WakeWordMode = 'hey-form' | 'coach' | 'disabled';

export interface VoiceControlState {
  /** User has opted in to voice control. Default: false. */
  enabled: boolean;
  /** Which wake-word policy is active. */
  wakeWordMode: WakeWordMode;
  /** Runtime flag — voice has paused the session. Not persisted. */
  voiceSessionPaused: boolean;

  setEnabled: (enabled: boolean) => void;
  setWakeWordMode: (mode: WakeWordMode) => void;
  setVoicePaused: (paused: boolean) => void;
  /** Convenience — resets runtime fields without touching user prefs. */
  resetRuntime: () => void;
}

const STORAGE_KEY = 'ff.voiceControl';

export const useVoiceControlStore = create<VoiceControlState>()(
  persist(
    (set) => ({
      enabled: false,
      wakeWordMode: 'hey-form' as WakeWordMode,
      voiceSessionPaused: false,

      setEnabled: (enabled) => {
        set({ enabled });
      },
      setWakeWordMode: (wakeWordMode) => {
        set({ wakeWordMode });
      },
      setVoicePaused: (voiceSessionPaused) => {
        set({ voiceSessionPaused });
      },
      resetRuntime: () => {
        set({ voiceSessionPaused: false });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // Persist only user preferences — NOT the ephemeral runtime flag.
      partialize: (state) => ({
        enabled: state.enabled,
        wakeWordMode: state.wakeWordMode,
      }),
    },
  ),
);

/**
 * Test-only helper. Resets the store to defaults so Jest cases are
 * independent. Production code should not call this.
 */
export function __resetVoiceControlStoreForTests(): void {
  useVoiceControlStore.setState({
    enabled: false,
    wakeWordMode: 'hey-form',
    voiceSessionPaused: false,
  });
}

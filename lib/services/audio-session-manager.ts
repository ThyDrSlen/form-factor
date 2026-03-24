import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

export type AudioSessionMode = 'idle' | 'tracking' | 'coaching';

const AUDIO_CONFIGS: Record<AudioSessionMode, Parameters<typeof Audio.setAudioModeAsync>[0]> = {
  idle: {
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    playsInSilentModeIOS: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  },
  tracking: {
    // ARKit active — play cues without interrupting camera
    allowsRecordingIOS: false,
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  },
  coaching: {
    // Voice mode — needs recording for STT
    allowsRecordingIOS: true,
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  },
};

export class AudioSessionManager {
  private static instance: AudioSessionManager;
  private currentMode: AudioSessionMode = 'idle';
  private listeners: Set<(mode: AudioSessionMode) => void> = new Set();

  static getInstance(): AudioSessionManager {
    if (!AudioSessionManager.instance) {
      AudioSessionManager.instance = new AudioSessionManager();
    }
    return AudioSessionManager.instance;
  }

  async setMode(mode: AudioSessionMode): Promise<void> {
    if (this.currentMode === mode) return;
    try {
      await Audio.setAudioModeAsync(AUDIO_CONFIGS[mode]);
      this.currentMode = mode;
      this.listeners.forEach((fn) => {
        fn(mode);
      });
    } catch (err) {
      console.warn('[AudioSessionManager] Failed to set mode:', mode, err);
    }
  }

  getMode(): AudioSessionMode {
    return this.currentMode;
  }

  canRecord(): boolean {
    return this.currentMode === 'coaching';
  }

  onModeChange(listener: (mode: AudioSessionMode) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const audioSessionManager = AudioSessionManager.getInstance();

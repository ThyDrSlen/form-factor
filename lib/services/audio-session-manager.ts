import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

export type AudioSessionMode = 'idle' | 'tracking' | 'coaching';

/**
 * Best-effort audio-output route. Kept broad because expo-av does not
 * expose a native route-change callback on all platforms — callers surface
 * route changes through {@link AudioSessionManager.notifyRouteChanged}.
 */
export type AudioRoute =
  | 'speaker'
  | 'receiver'
  | 'headphones'
  | 'bluetooth'
  | 'usb'
  | 'airplay'
  | 'unknown';

export interface RouteChangeEvent {
  previous: AudioRoute;
  current: AudioRoute;
  fellBackToSpeaker: boolean;
  timestamp: number;
}

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
  private cancelListeners: Set<() => void> = new Set();
  private routeListeners: Set<(event: RouteChangeEvent) => void> = new Set();
  private currentRoute: AudioRoute = 'unknown';

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

  /**
   * Interrupt any in-flight speech / audio playback.
   *
   * Designed as a fan-out: TTS layers (expo-speech, streaming mp3 player, etc.)
   * register via {@link onCancelRequested} and perform their own stop logic.
   * The cue-engine calls this when a higher-priority cue needs to preempt a
   * lower-priority one that is still playing through.
   *
   * Listeners run synchronously and any thrown errors are swallowed so one
   * misbehaving listener can't block the others.
   */
  cancel(): void {
    for (const listener of this.cancelListeners) {
      try {
        listener();
      } catch (err) {
        console.warn('[AudioSessionManager] cancel listener threw:', err);
      }
    }
  }

  /**
   * Register a cancel listener. Returns an unsubscribe function.
   *
   * Typical wiring: the speech-feedback hook registers a listener that calls
   * `Speech.stop()` and clears its queue tail.
   */
  onCancelRequested(listener: () => void): () => void {
    this.cancelListeners.add(listener);
    return () => {
      this.cancelListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Route-change plumbing
  //
  // expo-av does not expose a first-class JS subscription to iOS
  // AVAudioSessionRouteChangeNotification (see issue #428). We therefore
  // model this as an observable surface that callers can drive from:
  //   - AppState change detection
  //   - A future native bridge (arkit-body-tracker / ff-healthkit could
  //     forward AVAudioSessionRouteChangeNotification payloads here).
  //
  // When a route change happens we surface it to every subscriber and, if
  // the device fell back to the built-in speaker, emit a friendly event
  // payload the UI layer can surface as a toast.
  // -------------------------------------------------------------------------

  getRoute(): AudioRoute {
    return this.currentRoute;
  }

  subscribeRouteChanges(listener: (event: RouteChangeEvent) => void): () => void {
    this.routeListeners.add(listener);
    return () => {
      this.routeListeners.delete(listener);
    };
  }

  notifyRouteChanged(nextRoute: AudioRoute): void {
    const previous = this.currentRoute;
    if (previous === nextRoute) return;
    this.currentRoute = nextRoute;
    const event: RouteChangeEvent = {
      previous,
      current: nextRoute,
      fellBackToSpeaker:
        nextRoute === 'speaker' &&
        (previous === 'headphones' || previous === 'bluetooth' || previous === 'airplay'),
      timestamp: Date.now(),
    };
    this.routeListeners.forEach((fn) => {
      try {
        fn(event);
      } catch {
        /* swallow listener errors */
      }
    });
  }
}

export const audioSessionManager = AudioSessionManager.getInstance();

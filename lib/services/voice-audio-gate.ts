/**
 * Voice Audio Gate (#469)
 *
 * Thin observer/adapter over `audio-session-manager` that relays its mode
 * changes to a VoiceSessionManager via `onCuePlaybackStart/End()`.
 *
 * Why a wrapper and not a direct edit to audio-session-manager.ts?
 *   - #433 owns audio-session-manager.ts. Touching that file would create
 *     a merge conflict. Instead, we subscribe to its existing
 *     `onModeChange` event emitter and translate mode transitions into
 *     voice duplex callbacks.
 *
 * Fallback polling:
 *   - If a future audio-session-manager revision ever removes the
 *     `onModeChange` API, the gate falls back to polling `getMode()`
 *     every 250ms. Production audio-session-manager DOES support
 *     onModeChange (verified at build time), so the polling path is a
 *     defensive safety net.
 */
import { audioSessionManager, type AudioSessionMode } from '@/lib/services/audio-session-manager';
import type { VoiceSessionManager } from '@/lib/services/voice-session-manager';

const DEFAULT_POLL_INTERVAL_MS = 250;

export interface VoiceAudioGateOptions {
  /** The voice session manager to notify when audio mode changes. */
  manager: VoiceSessionManager;
  /**
   * Interval in ms for the polling fallback. Only used when the audio
   * session manager does not expose `onModeChange`. Defaults to 250ms.
   */
  pollIntervalMs?: number;
  /**
   * Optional override — test rigs inject a stub audio manager.
   */
  audioManager?: {
    onModeChange?: (cb: (mode: AudioSessionMode) => void) => () => void;
    getMode: () => AudioSessionMode;
  };
}

export interface VoiceAudioGate {
  /** Called to stop observing; cleans up listeners / intervals. */
  dispose: () => void;
}

/**
 * Start forwarding audio mode transitions to the voice manager.
 *
 * A 'coaching' → 'tracking' transition means the cue stopped and we
 * should resume listening. 'tracking' → 'coaching' means a cue started.
 *
 * Rationale: the coaching mode is entered whenever expo-speech-recognition
 * needs the mic (i.e. during voice input). The cue subsystem stays in
 * 'tracking' mode. So the relevant edge for duplex gating is actually the
 * presence/absence of cue PLAYBACK, which surfaces differently in
 * audio-session-manager. Since the manager reports only mode (not
 * playback state), we approximate: any entry into 'idle' with a prior
 * non-idle mode signals cue end; any entry into 'tracking' after
 * starting voice signals cue active. This is tuned for the current
 * audio-session-manager; the mapping can be refined as #433 evolves.
 */
export function createVoiceAudioGate(options: VoiceAudioGateOptions): VoiceAudioGate {
  const {
    manager,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    audioManager = audioSessionManager,
  } = options;

  let lastMode: AudioSessionMode = audioManager.getMode();
  let unsubscribe: (() => void) | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const handleTransition = (next: AudioSessionMode) => {
    const prev = lastMode;
    if (next === prev) return;
    lastMode = next;
    // Cue playback start: any non-tracking → tracking, with the understanding
    // that tracking implies "cues may be playing".
    if (next === 'tracking' && prev !== 'tracking') {
      manager.onCuePlaybackStart();
    }
    // Cue playback end: tracking → anything else.
    if (prev === 'tracking' && next !== 'tracking') {
      manager.onCuePlaybackEnd();
    }
  };

  if (typeof audioManager.onModeChange === 'function') {
    unsubscribe = audioManager.onModeChange((mode) => {
      handleTransition(mode);
    });
  } else {
    // Fallback polling path — documented above.
    pollInterval = setInterval(() => {
      handleTransition(audioManager.getMode());
    }, pollIntervalMs);
  }

  return {
    dispose: () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    },
  };
}

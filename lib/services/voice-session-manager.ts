/**
 * Voice Session Manager (#469)
 *
 * Coordinates the lifecycle of hands-free voice input during a form-tracking
 * session. This is a pure state machine + event router — it does NOT own
 * the speech recognition subscription itself (hooks/use-speech-to-text.ts
 * already does that). The manager's job is to decide WHEN we accept a
 * transcript and WHICH transcripts count as commands.
 *
 * State machine:
 *
 *     [idle] --start()--> [listening] --transcript + wake--> [processing]
 *         ^                   |                                   |
 *         |                   v                                   v
 *      [disabled] <- stop() - + <-- onCuePlaybackStart --> [speaking]
 *
 * Wake-word gate:
 *   - Accepts transcripts starting with "hey form" or "coach" (case-insens.).
 *   - Bare command words without wake word are rejected as noise.
 *   - Gating is done here so the classifier stays agnostic and usable
 *     from other contexts (e.g. test rigs that bypass wake-word).
 *
 * Duplex coordination:
 *   - Cue audio (expo-speech / MP3 cues) takes priority. When
 *     onCuePlaybackStart fires, we transition to 'speaking' and silently
 *     drop any transcripts until onCuePlaybackEnd.
 *   - This prevents the coach speaking "Keep your back straight" and the
 *     microphone picking up "straight" as a command.
 */

export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'disabled';

export type VoiceSessionEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'TRANSCRIPT'; transcript: string }
  | { type: 'CUE_PLAYBACK_START' }
  | { type: 'CUE_PLAYBACK_END' }
  | { type: 'PROCESSING_DONE' };

export interface WakeWordResult {
  /** Whether the transcript was gated through. */
  accepted: boolean;
  /** Transcript with the wake word stripped — ready for classifier. */
  stripped: string;
  /** Which wake token matched, or null if rejected. */
  wakeWord: string | null;
}

export interface VoiceSessionManager {
  getState: () => VoiceSessionState;
  start: () => void;
  stop: () => void;
  /**
   * Feed a raw transcript into the machine. Returns the wake-word-stripped
   * transcript (ready for classifyIntent) if accepted, or null if dropped.
   */
  ingestTranscript: (raw: string) => string | null;
  onCuePlaybackStart: () => void;
  onCuePlaybackEnd: () => void;
  onStateChange: (cb: (state: VoiceSessionState) => void) => () => void;
}

// ---------------------------------------------------------------------------
// Wake-word helpers
// ---------------------------------------------------------------------------

/** Tokens that count as the wake word, matched at the start of the utterance. */
export const WAKE_WORD_TOKENS = ['hey form', 'hey coach', 'coach'] as const;

/**
 * Pure helper — independent of the state machine so unit tests can assert
 * the wake-word policy in isolation.
 */
export function checkWakeWord(raw: string): WakeWordResult {
  const lower = (raw ?? '').toLowerCase().trim();
  if (!lower) {
    return { accepted: false, stripped: '', wakeWord: null };
  }
  for (const token of WAKE_WORD_TOKENS) {
    // Must be followed by whitespace or end-of-string so we don't match
    // "coaches" as "coach".
    const re = new RegExp(`^${token.replace(/\s+/g, '\\s+')}\\b\\s*,?\\s*`, 'i');
    if (re.test(lower)) {
      return {
        accepted: true,
        stripped: lower.replace(re, '').trim(),
        wakeWord: token,
      };
    }
  }
  return { accepted: false, stripped: lower, wakeWord: null };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a fresh session manager. We prefer factory-over-singleton here
 * so tests get a clean slate per case without resetting module-scoped
 * state.
 */
export function createVoiceSessionManager(): VoiceSessionManager {
  let state: VoiceSessionState = 'idle';
  // Whether the user has explicitly invoked start(). Lets us distinguish
  // 'idle' (stopped by user) from 'listening' (start() called) when
  // cue playback ends.
  let wantsListening = false;
  const listeners = new Set<(s: VoiceSessionState) => void>();

  const setState = (next: VoiceSessionState) => {
    if (next === state) return;
    state = next;
    listeners.forEach((fn) => {
      fn(next);
    });
  };

  const manager: VoiceSessionManager = {
    getState: () => state,

    start: () => {
      wantsListening = true;
      // Don't override 'speaking' — duplex gating takes precedence.
      if (state === 'speaking') return;
      setState('listening');
    },

    stop: () => {
      wantsListening = false;
      setState('idle');
    },

    ingestTranscript: (raw: string) => {
      // Drop transcripts outside the listening state. This is the duplex
      // gate: while the coach speaks, nothing the mic hears counts.
      if (state !== 'listening') return null;
      const result = checkWakeWord(raw);
      if (!result.accepted) return null;
      setState('processing');
      // The caller (hook layer) is expected to run classifyIntent +
      // executeIntent then call through — we use a microtask to
      // transition back to 'listening' automatically so tests and the
      // runtime don't need an explicit "done" signal unless cue
      // playback has started.
      queueMicrotask(() => {
        if (state === 'processing' && wantsListening) {
          setState('listening');
        }
      });
      return result.stripped;
    },

    onCuePlaybackStart: () => {
      setState('speaking');
    },

    onCuePlaybackEnd: () => {
      // Only resume listening if the user asked for it.
      setState(wantsListening ? 'listening' : 'idle');
    },

    onStateChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  return manager;
}

// A default manager instance shared across the app. Callers should prefer
// this over creating new managers ad-hoc so the duplex gating is
// consistent with whatever owns the mic subscription.
export const voiceSessionManager = createVoiceSessionManager();

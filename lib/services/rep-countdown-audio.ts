/**
 * Rep Countdown Audio
 *
 * Plays a short 3-2-1 pre-announce before rep counting begins so the
 * athlete can sync their first rep with the coaching voice. Runs on
 * both iOS + Android (falls back to expo-speech when custom MP3s are
 * not generated). Web is a safe no-op.
 *
 * Architecture mirrors the in-session cue pipeline:
 *   - uses expo-speech for the spoken digits
 *   - pulses expo-haptics at each tick for tactile rhythm
 *   - honors the user's rep-countdown preference (default on)
 *
 * The function resolves when the full "3… 2… 1… go" line has played.
 * Callers should await it before starting any hard-rep detection so
 * the first rep does not race the final haptic.
 */
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

import { getRepCountdownEnabled } from '@/lib/services/rep-countdown-pref';

export const REP_COUNTDOWN_STEP_MS = 1000;

export interface PlayRepCountdownOptions {
  /** Skip reading the preference when the caller already knows. */
  forceEnabled?: boolean;
  /** Override the TTS voice (defaults to system default). */
  voiceId?: string;
  /** Override the TTS language (defaults to en-US). */
  language?: string;
  /** Override the TTS rate (defaults to 0.9). */
  rate?: number;
  /** Injectable timer for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable speaker for deterministic tests. */
  speak?: (phrase: string) => Promise<void>;
  /** Injectable haptic pulse for deterministic tests. */
  pulse?: (kind: 'tick' | 'go') => Promise<void>;
}

export interface PlayRepCountdownResult {
  /** Whether the countdown actually played. */
  played: boolean;
  /** Reason it was skipped (when `played === false`). */
  reason?: 'disabled' | 'unsupported_platform';
  /** Phrases that were spoken, in order. Useful for tests + telemetry. */
  spoken: string[];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function defaultSpeak(
  phrase: string,
  voiceId: string | undefined,
  language: string,
  rate: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      Speech.speak(phrase, {
        voice: voiceId,
        language,
        rate,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

async function defaultPulse(kind: 'tick' | 'go'): Promise<void> {
  try {
    if (Platform.OS === 'web') return;
    if (kind === 'tick') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  } catch {
    // best-effort — haptics on older devices may throw
  }
}

/**
 * Play the "3… 2… 1… go" countdown. Honors the user preference by
 * default; pass `forceEnabled: true` to bypass (for manual previews).
 */
export async function playRepCountdown(
  options: PlayRepCountdownOptions = {},
): Promise<PlayRepCountdownResult> {
  const {
    forceEnabled,
    voiceId,
    language = 'en-US',
    rate = 0.9,
    sleep = defaultSleep,
    speak,
    pulse = defaultPulse,
  } = options;

  if (Platform.OS === 'web') {
    return { played: false, reason: 'unsupported_platform', spoken: [] };
  }

  const enabled = forceEnabled ?? (await getRepCountdownEnabled());
  if (!enabled) {
    return { played: false, reason: 'disabled', spoken: [] };
  }

  const say = speak ?? ((phrase: string) => defaultSpeak(phrase, voiceId, language, rate));

  const ticks: { phrase: string; kind: 'tick' | 'go' }[] = [
    { phrase: '3', kind: 'tick' },
    { phrase: '2', kind: 'tick' },
    { phrase: '1', kind: 'tick' },
    { phrase: 'go', kind: 'go' },
  ];

  const spoken: string[] = [];
  for (let i = 0; i < ticks.length; i += 1) {
    const tick = ticks[i];
    await Promise.all([pulse(tick.kind), say(tick.phrase)]);
    spoken.push(tick.phrase);
    if (i < ticks.length - 1) {
      await sleep(REP_COUNTDOWN_STEP_MS);
    }
  }

  return { played: true, spoken };
}

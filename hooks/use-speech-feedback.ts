import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { Audio, InterruptionModeIOS } from 'expo-av';

interface SpeechFeedbackOptions {
  enabled: boolean;
  voiceId?: string;
  language?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  minIntervalMs?: number;
  shouldAllowRecording?: boolean;
}

interface SpeechFeedbackControls {
  speak: (phrase: string, options?: { immediate?: boolean }) => void;
  stop: () => void;
}

export function useSpeechFeedback({
  enabled,
  voiceId,
  language = 'en-US',
  rate = 0.55,
  pitch = 1.0,
  volume = 1,
  minIntervalMs = 2000,
  shouldAllowRecording = true,
}: SpeechFeedbackOptions): SpeechFeedbackControls {
  const queueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);
  const lastPhraseRef = useRef<string | null>(null);
  const lastTimestampRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioConfiguredRef = useRef(false);

  // Reset audio config when recording requirement changes
  useEffect(() => {
    audioConfiguredRef.current = false;
    ensureAudioMode().catch(() => {});
  }, [shouldAllowRecording]);

  const ensureAudioMode = useCallback(async () => {
    if (audioConfiguredRef.current) {
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: shouldAllowRecording,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      audioConfiguredRef.current = true;
    } catch (error) {
      audioConfiguredRef.current = false;
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[SpeechFeedback] Failed to set audio mode', error);
      }
    }
  }, [shouldAllowRecording]);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (!enabled) {
      queueRef.current = [];
      lastPhraseRef.current = null;
      clearPendingTimeout();
      if (isSpeakingRef.current) {
        Speech.stop();
        isSpeakingRef.current = false;
      }
      return;
    }

    if (isSpeakingRef.current) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastTimestampRef.current;

    if (elapsed < minIntervalMs) {
      clearPendingTimeout();
      timeoutRef.current = setTimeout(() => {
        flushQueue().catch(() => {});
      }, minIntervalMs - elapsed);
      return;
    }

    const next = queueRef.current.shift();
    if (!next) {
      return;
    }

    await ensureAudioMode();

    isSpeakingRef.current = true;
    lastPhraseRef.current = next;
    lastTimestampRef.current = now;

    Speech.speak(next, {
      voice: voiceId,
      language,
      rate,
      pitch,
      volume,
      onDone: () => {
        isSpeakingRef.current = false;
        flushQueue().catch(() => {});
      },
      onStopped: () => {
        isSpeakingRef.current = false;
        flushQueue().catch(() => {});
      },
      onError: () => {
        isSpeakingRef.current = false;
        flushQueue().catch(() => {});
      },
    });
  }, [enabled, voiceId, language, rate, pitch, volume, minIntervalMs, clearPendingTimeout, ensureAudioMode, shouldAllowRecording]);

  const speak = useCallback(
    (phrase: string, options?: { immediate?: boolean }) => {
      const text = phrase?.trim();
      if (!text) {
        return;
      }

      if (!enabled) {
        return;
      }

      const now = Date.now();
      const lastPhrase = lastPhraseRef.current;
      if (lastPhrase === text && now - lastTimestampRef.current < minIntervalMs) {
        return;
      }

      const queue = queueRef.current;
      if (!options?.immediate && queue[queue.length - 1] === text) {
        return;
      }

      if (options?.immediate) {
        queue.unshift(text);
      } else {
        queue.push(text);
      }

      flushQueue().catch(() => {});
    },
    [enabled, flushQueue, minIntervalMs]
  );

  const stop = useCallback(() => {
    queueRef.current = [];
    clearPendingTimeout();
    Speech.stop();
    isSpeakingRef.current = false;
  }, [clearPendingTimeout]);

  useEffect(() => {
    if (!enabled) {
      stop();
    } else {
      ensureAudioMode().catch(() => {});
      flushQueue().catch(() => {});
    }

    return () => {
      stop();
    };
  }, [enabled, flushQueue, stop, ensureAudioMode]);

  return { speak, stop };
}

import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { warnWithTs } from '@/lib/logger';
import { Audio, InterruptionModeIOS } from 'expo-av';
import { createError, logError } from '@/lib/services/ErrorHandler';

interface SpeechFeedbackOptions {
  enabled: boolean;
  voiceId?: string;
  language?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  minIntervalMs?: number;
  shouldAllowRecording?: boolean;
  onEvent?: (event: {
    cue: string;
    action: 'queued' | 'spoken' | 'dropped';
    reason?: string;
    throttled?: boolean;
    elapsedMs?: number;
  }) => void;
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
  onEvent,
}: SpeechFeedbackOptions): SpeechFeedbackControls {
  const queueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);
  const lastPhraseRef = useRef<string | null>(null);
  const lastTimestampRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioConfiguredRef = useRef(false);

  const reportAsyncError = useCallback((code: string, message: string, error: unknown) => {
    logError(
      createError('unknown', code, message, {
        details: error,
        severity: 'warning',
        retryable: true,
      }),
      {
        feature: 'app',
        location: 'hooks/use-speech-feedback',
      }
    );
  }, []);

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
        warnWithTs('[SpeechFeedback] Failed to set audio mode', error);
      }
    }
  }, [shouldAllowRecording]);

  // Reset audio config when recording requirement changes
  useEffect(() => {
    audioConfiguredRef.current = false;
    ensureAudioMode().catch((error) => {
      reportAsyncError('SPEECH_AUDIO_RECONFIG_FAILED', 'Failed to reconfigure speech audio mode', error);
    });
  }, [ensureAudioMode, reportAsyncError, shouldAllowRecording]);

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
      if (queueRef.current[0]) {
        onEvent?.({
          cue: queueRef.current[0],
          action: 'dropped',
          reason: 'throttled_interval',
          throttled: true,
          elapsedMs: elapsed,
        });
      }
      timeoutRef.current = setTimeout(() => {
        flushQueue().catch((error) => {
          reportAsyncError('SPEECH_FLUSH_RETRY_FAILED', 'Failed to flush speech queue after throttle delay', error);
        });
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
    onEvent?.({ cue: next, action: 'spoken' });

    Speech.speak(next, {
      voice: voiceId,
      language,
      rate,
      pitch,
      volume,
      onDone: () => {
        isSpeakingRef.current = false;
        flushQueue().catch((error) => {
          reportAsyncError('SPEECH_FLUSH_ON_DONE_FAILED', 'Failed to flush speech queue after completion', error);
        });
      },
      onStopped: () => {
        isSpeakingRef.current = false;
        flushQueue().catch((error) => {
          reportAsyncError('SPEECH_FLUSH_ON_STOP_FAILED', 'Failed to flush speech queue after stop', error);
        });
      },
      onError: () => {
        isSpeakingRef.current = false;
        onEvent?.({ cue: next, action: 'dropped', reason: 'speech_error' });
        flushQueue().catch((error) => {
          reportAsyncError('SPEECH_FLUSH_ON_ERROR_FAILED', 'Failed to recover speech queue after speech error', error);
        });
      },
    });
  }, [enabled, voiceId, language, rate, pitch, volume, minIntervalMs, clearPendingTimeout, ensureAudioMode, onEvent, reportAsyncError]);

  const speak = useCallback(
    (phrase: string, options?: { immediate?: boolean }) => {
      const text = phrase?.trim();
      if (!text) {
        return;
      }

      if (!enabled) {
        onEvent?.({ cue: text, action: 'dropped', reason: 'disabled' });
        return;
      }

      const now = Date.now();
      const lastPhrase = lastPhraseRef.current;
      if (lastPhrase === text && now - lastTimestampRef.current < minIntervalMs) {
        onEvent?.({
          cue: text,
          action: 'dropped',
          reason: 'throttled_same_cue',
          throttled: true,
          elapsedMs: now - lastTimestampRef.current,
        });
        return;
      }

      const queue = queueRef.current;
      if (!options?.immediate && queue[queue.length - 1] === text) {
        onEvent?.({ cue: text, action: 'dropped', reason: 'duplicate_in_queue' });
        return;
      }

      if (options?.immediate) {
        queue.unshift(text);
      } else {
        queue.push(text);
      }
      onEvent?.({ cue: text, action: 'queued' });

      flushQueue().catch((error) => {
        reportAsyncError('SPEECH_FLUSH_ENQUEUE_FAILED', 'Failed to flush speech queue after enqueue', error);
      });
    },
    [enabled, flushQueue, minIntervalMs, onEvent, reportAsyncError]
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
      ensureAudioMode().catch((error) => {
        reportAsyncError('SPEECH_AUDIO_MODE_INIT_FAILED', 'Failed to initialize speech audio mode', error);
      });
      flushQueue().catch((error) => {
        reportAsyncError('SPEECH_FLUSH_INIT_FAILED', 'Failed to initialize speech queue processing', error);
      });
    }

    return () => {
      stop();
    };
  }, [enabled, flushQueue, stop, ensureAudioMode, reportAsyncError]);

  return { speak, stop };
}

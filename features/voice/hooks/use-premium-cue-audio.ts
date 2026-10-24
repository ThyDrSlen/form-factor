import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { Paths, File as ExpoFile } from 'expo-file-system';
import { Audio, InterruptionModeIOS } from 'expo-av';
import { createError, logError } from '@/lib/services/ErrorHandler';
import { audioSessionManager } from '@/lib/services/audio-session-manager';
import { mapSeverityToAudioHint, type CueAudioHint } from '@/lib/services/cue-priority-audio';
import { EXERCISE_CUE_POLICY, ExerciseCuePolicy, type ExerciseAudioCue, type ExerciseAudioObservation } from '@/lib/services/exercise-cue-policy';
import type { FaultSeverity } from '@/lib/types/workout-definitions';
import { useFormTrackingSettings } from '@/features/form-tracking/hooks/use-form-tracking-settings';

let cueManifest: Record<string, string> = {};
try {
  cueManifest = require('../../../assets/audio/cues/cue-manifest.json');
} catch {
  // Missing generated assets safely fall back to system speech.
}

interface PremiumCueAudioOptions {
  enabled: boolean;
  exerciseId?: string;
  /** Session + exercise identity. Changes cancel even before the next observation. */
  contextKey?: string;
  voiceId?: string;
  language?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** May lengthen, never shorten, the conservative global cooldown. */
  minIntervalMs?: number;
  shouldAllowRecording?: boolean;
  /** Priority never overrides mute, user volume, or the global cooldown. */
  priorityHint?: FaultSeverity | Partial<CueAudioHint>;
  onEvent?: (event: {
    cue: string;
    action: 'queued' | 'spoken' | 'dropped';
    reason?: string;
    throttled?: boolean;
    elapsedMs?: number;
  }) => void;
}

interface PremiumCueAudioControls {
  /** Feed every fresh RAW sample, including empty/low-confidence observations. */
  observe: (input: ExerciseAudioObservation) => void;
  /** Compatibility for explicit speech, not tracking evidence. No FIFO or immediate bypass. */
  speak: (phrase: string, options?: { immediate?: boolean }) => void;
  stop: () => void;
}

/** One player for both MP3 assets and system speech. No deferred playback queue. */
export function usePremiumCueAudio(options: PremiumCueAudioOptions): PremiumCueAudioControls {
  const { loading, resolve } = useFormTrackingSettings();
  const hintVolume = typeof options.priorityHint === 'object' ? options.priorityHint.volume ?? 1 : 1;
  const enabled = options.enabled && (options.volume ?? 1) > 0 && hintVolume > 0 && !loading && resolve(options.exerciseId).voiceEnabled;
  const optionsRef = useRef(options);
  optionsRef.current = { ...options, enabled };
  const mountedRef = useRef(true);
  const foregroundRef = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const lastStartRef = useRef(-Infinity);
  const audioConfiguredRef = useRef(false);
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const stopBarrierRef = useRef<Promise<unknown>>(Promise.resolve());
  const policyRef = useRef(new ExerciseCuePolicy());
  const contextRef = useRef<string | null>(null);
  const spokenTextRef = useRef(new Set<string>());
  const observedPlaybackRef = useRef<{
    cue: ExerciseAudioCue; contextKey: string; generation: number; started: boolean;
  } | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExpiry = useCallback(() => {
    if (expiryTimerRef.current !== null) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }, []);

  const cancelPlayback = useCallback(() => {
    generationRef.current += 1;
    clearExpiry();
    observedPlaybackRef.current = null;
    const wasBusy = busyRef.current;
    busyRef.current = false;
    audioConfiguredRef.current = false;
    finishRef.current?.();
    finishRef.current = null;
    const sound = activeSoundRef.current;
    activeSoundRef.current = null;
    // Never stop another voice surface just because this (disabled) hook unmounted.
    const jobs: Promise<unknown>[] = [stopBarrierRef.current];
    if (wasBusy) jobs.push(Promise.resolve(Speech.stop()).catch(() => {}));
    if (sound) jobs.push(sound.unloadAsync().catch(() => {}));
    stopBarrierRef.current = Promise.all(jobs);
  }, [clearExpiry]);

  const revalidateObservedPlayback = useCallback(function revalidate(generation: number) {
    const active = observedPlaybackRef.current;
    if (!active || active.generation !== generation || generation !== generationRef.current) return;
    clearExpiry();
    const now = Date.now();
    const expiresAt = policyRef.current.validUntil(active.cue, active.contextKey, now, !active.started);
    if (expiresAt === null) {
      // Evidence cancellation must not rearm a spoken issue or reset cooldown.
      cancelPlayback();
      return;
    }
    expiryTimerRef.current = setTimeout(() => revalidate(generation), expiresAt - now + 1);
  }, [cancelPlayback, clearExpiry]);

  const stop = useCallback(() => {
    cancelPlayback();
    policyRef.current.reset();
    contextRef.current = null;
    spokenTextRef.current.clear();
  }, [cancelPlayback]);

  const play = useCallback((text: string, cue?: ExerciseAudioCue): boolean => {
    const config = optionsRef.current;
    const hint = typeof config.priorityHint === 'number'
      ? mapSeverityToAudioHint(config.priorityHint) : config.priorityHint;
    const volume = Math.min(config.volume ?? 1, hint?.volume ?? 1);
    const interval = Math.max(EXERCISE_CUE_POLICY.cooldownMs, config.minIntervalMs ?? 0, hint?.intervalMs ?? 0);
    const now = Date.now();
    const drop = (reason: string) => config.onEvent?.({ cue: text, action: 'dropped', reason });
    if (!mountedRef.current || !foregroundRef.current || !config.enabled || !(volume > 0)) {
      drop('disabled');
      return false;
    }
    if (busyRef.current) { drop('busy'); return false; }
    if (now - lastStartRef.current < interval) { drop('throttled_interval'); return false; }
    if (!cue && spokenTextRef.current.has(text)) { drop('throttled_same_cue'); return false; }

    // Reserve BEFORE any await. Bursty calls cannot race audio setup or file loading.
    busyRef.current = true;
    const generation = ++generationRef.current;
    const contextKey = contextRef.current;
    if (cue && contextKey !== null) {
      observedPlaybackRef.current = { cue: { ...cue }, contextKey, generation, started: false };
      revalidateObservedPlayback(generation);
    }
    const valid = () => mountedRef.current && foregroundRef.current && optionsRef.current.enabled &&
      generation === generationRef.current && optionsRef.current.contextKey === config.contextKey;
    const fresh = () => valid() && (cue
      ? contextKey !== null && policyRef.current.validUntil(cue, contextKey, Date.now(), true) !== null
      : Date.now() - now <= EXERCISE_CUE_POLICY.maxSampleGapMs);
    const onStarted = () => {
      if (observedPlaybackRef.current?.generation === generation) observedPlaybackRef.current.started = true;
      lastStartRef.current = Date.now();
      if (cue) policyRef.current.markSpoken(cue, lastStartRef.current);
      else spokenTextRef.current.add(text);
      optionsRef.current.onEvent?.({ cue: text, action: 'spoken' });
    };
    const run = async () => {
      await stopBarrierRef.current;
      if (!fresh()) return;
      if (!audioConfiguredRef.current) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: config.shouldAllowRecording ?? true,
          staysActiveInBackground: false,
          playsInSilentModeIOS: true,
          interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        if (!fresh()) return;
        audioConfiguredRef.current = true;
      }
      const filename = cueManifest[text.toLowerCase().trim()];
      if (filename) {
        // Per-play ownership avoids the previous module-global cache leaking
        // playback across unmounts or another hook instance.
        const file = new ExpoFile(Paths.document, `audio/cues/${filename}`);
        if (file.exists) {
          let sound: Audio.Sound | null = null;
          try {
            ({ sound } = await Audio.Sound.createAsync({ uri: file.uri }, { shouldPlay: false, volume }));
            if (!fresh()) { await sound.unloadAsync(); return; }
            activeSoundRef.current = sound;
            const done = new Promise<void>((resolve) => {
              finishRef.current = resolve;
              sound!.setOnPlaybackStatusUpdate((status) => {
                if (!status.isLoaded || status.didJustFinish) resolve();
              });
            });
            onStarted();
            await sound.playAsync();
            await done;
            return;
          } catch {
            if (sound) {
              if (activeSoundRef.current === sound) activeSoundRef.current = null;
              await sound.unloadAsync().catch(() => {});
            }
            if (!fresh()) return;
            // An unavailable asset may fall back, but never after cancellation.
          }
        }
      }
      if (!fresh()) return;
      await new Promise<void>((resolve) => {
        finishRef.current = resolve;
        Speech.speak(text, {
          voice: config.voiceId,
          language: config.language ?? 'en-US',
          rate: config.rate ?? 0.55,
          pitch: config.pitch ?? 1,
          volume,
          onDone: resolve,
          onStopped: resolve,
          onError: () => { drop('speech_error'); resolve(); },
        });
        onStarted();
      });
    };
    void run().catch((error) => {
      if (valid()) {
        drop('playback_error');
        logError(createError('unknown', 'PREMIUM_AUDIO_PLAYBACK_FAILED', 'Cue playback failed', {
          details: error, severity: 'warning', retryable: true,
        }), { feature: 'app', location: 'features/voice/hooks/use-premium-cue-audio' });
      }
    }).finally(() => {
      // A late callback from cancelled audio must not unlock a newer utterance.
      if (generation !== generationRef.current) return;
      clearExpiry();
      observedPlaybackRef.current = null;
      busyRef.current = false;
      finishRef.current = null;
      const sound = activeSoundRef.current;
      activeSoundRef.current = null;
      if (sound) void sound.unloadAsync().catch(() => {});
    });
    return true;
  }, [clearExpiry, revalidateObservedPlayback]);

  const speak = useCallback((phrase: string) => {
    const text = phrase?.trim();
    if (text) play(text);
  }, [play]);

  const observe = useCallback((input: ExerciseAudioObservation) => {
    if (!optionsRef.current.enabled || !foregroundRef.current || !mountedRef.current) return;
    if (optionsRef.current.contextKey !== undefined && optionsRef.current.contextKey !== input.contextKey) return;
    if (contextRef.current !== input.contextKey) {
      stop();
      contextRef.current = input.contextKey;
    }
    const cue = policyRef.current.observe(input, Date.now());
    revalidateObservedPlayback(generationRef.current);
    if (cue) play(cue.message, cue);
  }, [play, stop, revalidateObservedPlayback]);

  useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled, options.contextKey, options.exerciseId, options.shouldAllowRecording, stop]);

  useEffect(() => {
    mountedRef.current = true;
    const offCancel = audioSessionManager.onCancelRequested(cancelPlayback);
    const offRoute = audioSessionManager.subscribeRouteChanges(cancelPlayback);
    const offMode = audioSessionManager.onModeChange((mode) => {
      if (mode !== 'tracking') cancelPlayback();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      foregroundRef.current = state === 'active';
      if (state !== 'active') cancelPlayback();
    });
    return () => {
      mountedRef.current = false;
      offCancel(); offRoute(); offMode(); subscription.remove();
      stop();
    };
  }, [cancelPlayback, stop]);

  return { speak, stop, observe };
}

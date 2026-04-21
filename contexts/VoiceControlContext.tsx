/**
 * VoiceControlContext (#wave24-voice)
 *
 * Production lifecycle owner for the shipped-but-unmounted voice services
 * (voice-session-manager + voice-intent-classifier + voice-command-executor).
 *
 * Responsibilities:
 *   1. Gate the whole pipeline behind EXPO_PUBLIC_VOICE_CONTROL_PIPELINE.
 *   2. Gate the mic subscription behind voice-privacy-policy.hasConsented().
 *   3. When both gates pass, call voiceSessionManager.start() on mount +
 *      stop() on unmount — no manual toggle required from consumers.
 *   4. Subscribe to the injected transcript source and pipe each transcript
 *      through: ingestTranscript (wake-word gate) → classifyIntent →
 *      executeIntent.
 *   5. Publish { isListening, latestIntent, audioLevel, consentRequired }
 *      on context for downstream UI (VoiceCommandFeedback, VoiceControlBanner).
 *
 * Design notes:
 *   - The transcript source is injected via `transcriptSource` prop so
 *     tests can drive the pipeline deterministically without mocking
 *     expo-speech-recognition. Production callers omit the prop and get
 *     a no-op source by default (wire-up to useSpeechToText is deferred
 *     to a follow-up wave that owns the mic state machine).
 *   - Executor wiring uses `buildExecutableRunner(useSessionRunner.getState(),
 *     weightPreference)` to stay in lockstep with the live session-runner.
 *     A weight-preference accessor is injected so we don't take a hard
 *     dep on UnitsContext (avoids test gymnastics).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  voiceSessionManager as defaultVoiceSessionManager,
  type VoiceSessionManager,
  type VoiceSessionState,
} from '@/lib/services/voice-session-manager';
import {
  classifyIntent,
  type ClassifiedIntent,
} from '@/lib/services/voice-intent-classifier';
import {
  buildExecutableRunner,
  executeIntent,
  type ExecutableRunner,
} from '@/lib/services/voice-command-executor';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { isVoiceControlPipelineEnabled } from '@/lib/services/voice-pipeline-flag';
import { hasConsented as defaultHasConsented } from '@/lib/services/voice-privacy-policy';
import { warnWithTs } from '@/lib/logger';

/**
 * A transcript source is anything that can push raw STT transcripts into
 * the context. Returns an unsubscribe function that the context calls on
 * unmount (or when the pipeline shuts down).
 */
export interface VoiceTranscriptSource {
  subscribe: (listener: (transcript: string) => void) => () => void;
  /** Optional live audio level in [0, 1]. Omit for silent sources. */
  getAudioLevel?: () => number;
}

export interface VoiceControlState {
  /** Whether the session manager is currently in the listening state. */
  isListening: boolean;
  /** Latest classified intent from the pipeline, or null if none yet. */
  latestIntent: ClassifiedIntent | null;
  /** Current audio level in [0, 1], or 0 when the source omits it. */
  audioLevel: number;
  /**
   * True when the pipeline flag is on but the user has not granted consent
   * (useVoiceControlStore.enabled === false). Consumers (banner, feedback)
   * can surface this to prompt the user; the context itself never opens
   * a consent UI.
   */
  consentRequired: boolean;
  /** True when the master pipeline flag is off (everything suppressed). */
  pipelineDisabled: boolean;
}

const DEFAULT_STATE: VoiceControlState = {
  isListening: false,
  latestIntent: null,
  audioLevel: 0,
  consentRequired: false,
  pipelineDisabled: true,
};

const VoiceControlContext = createContext<VoiceControlState>(DEFAULT_STATE);

export interface VoiceControlProviderProps {
  children: React.ReactNode;
  /** Override the default singleton session manager (tests only). */
  manager?: VoiceSessionManager;
  /** Push transcripts into the pipeline. Omit for production defaults. */
  transcriptSource?: VoiceTranscriptSource;
  /** Override the flag read (tests only). */
  isPipelineEnabled?: () => boolean;
  /** Override the consent read (tests only). */
  hasConsented?: () => boolean;
  /**
   * Build the executor adapter. Defaults to pulling the live session-runner
   * state + metric weight preference. Tests inject a mock to assert calls.
   */
  buildRunner?: () => ExecutableRunner;
}

/** A transcript source that never emits — the production default. */
const NOOP_TRANSCRIPT_SOURCE: VoiceTranscriptSource = {
  subscribe: () => () => {
    /* noop */
  },
};

export function VoiceControlProvider({
  children,
  manager = defaultVoiceSessionManager,
  transcriptSource = NOOP_TRANSCRIPT_SOURCE,
  isPipelineEnabled = isVoiceControlPipelineEnabled,
  hasConsented = defaultHasConsented,
  buildRunner,
}: VoiceControlProviderProps) {
  const [managerState, setManagerState] = useState<VoiceSessionState>(manager.getState());
  const [latestIntent, setLatestIntent] = useState<ClassifiedIntent | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const pipelineDisabled = !isPipelineEnabled();
  const consented = pipelineDisabled ? false : hasConsented();

  // Refs for hot-path callbacks so the subscribe effect doesn't churn.
  const managerRef = useRef(manager);
  managerRef.current = manager;
  const buildRunnerRef = useRef(buildRunner);
  buildRunnerRef.current = buildRunner;

  /**
   * Process a single raw transcript through the full pipeline. Errors are
   * logged and swallowed — the voice path must never crash the UI.
   */
  const handleTranscript = useCallback(async (raw: string) => {
    try {
      const stripped = managerRef.current.ingestTranscript(raw);
      if (stripped === null) return;
      const classified = classifyIntent(raw);
      setLatestIntent(classified);
      if (classified.intent === 'none') return;
      const runner = buildRunnerRef.current
        ? buildRunnerRef.current()
        : buildExecutableRunner(useSessionRunner.getState(), 'metric');
      await executeIntent(classified, runner);
    } catch (err) {
      warnWithTs('[VoiceControlContext] handleTranscript failed', err);
    }
  }, []);

  // Subscribe to manager state transitions.
  useEffect(() => {
    const off = manager.onStateChange(setManagerState);
    setManagerState(manager.getState());
    return () => {
      off();
    };
  }, [manager]);

  // Lifecycle: start manager + subscribe to transcripts when both gates pass.
  useEffect(() => {
    if (pipelineDisabled || !consented) return;
    manager.start();
    const unsubscribe = transcriptSource.subscribe((raw) => {
      void handleTranscript(raw);
    });
    return () => {
      unsubscribe();
      manager.stop();
    };
  }, [pipelineDisabled, consented, manager, transcriptSource, handleTranscript]);

  // Poll audio level if the source publishes one. Kept cheap (10Hz).
  useEffect(() => {
    if (pipelineDisabled || !consented) {
      setAudioLevel(0);
      return;
    }
    const reader = transcriptSource.getAudioLevel;
    if (!reader) return;
    const interval = setInterval(() => {
      setAudioLevel(reader());
    }, 100);
    return () => {
      clearInterval(interval);
    };
  }, [pipelineDisabled, consented, transcriptSource]);

  const value = useMemo<VoiceControlState>(
    () => ({
      isListening: managerState === 'listening',
      latestIntent,
      audioLevel,
      consentRequired: !pipelineDisabled && !consented,
      pipelineDisabled,
    }),
    [managerState, latestIntent, audioLevel, pipelineDisabled, consented],
  );

  return (
    <VoiceControlContext.Provider value={value}>
      {children}
    </VoiceControlContext.Provider>
  );
}

/**
 * Read the current voice-control state. Safe to call from any component
 * in the tree — returns the inert default when the provider is not
 * mounted (e.g. flag off / provider fell through).
 */
export function useVoiceControl(): VoiceControlState {
  return useContext(VoiceControlContext);
}

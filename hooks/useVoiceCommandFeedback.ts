/**
 * useVoiceCommandFeedback (#469)
 *
 * React hook that bridges the voice-session-manager state + classified
 * intent into a display state for <VoiceCommandFeedback /> overlay.
 *
 * Display state machine:
 *   - 'idle'          — manager in idle or disabled state
 *   - 'listening'     — manager listening (mic hot), waiting for wake word
 *   - 'recognized'    — high-confidence classified intent (animated + haptic)
 *   - 'unrecognized'  — wake-word matched but confidence below threshold
 *
 * The hook does NOT run classification itself — callers pass the latest
 * ClassifiedIntent (or null). This keeps the hook stateless re: the
 * classifier, so it can be unit-tested without mocking the regex engine.
 */
import { useEffect, useMemo, useState } from 'react';
import type { VoiceSessionManager, VoiceSessionState } from '@/lib/services/voice-session-manager';
import { CONFIDENCE_THRESHOLD, type ClassifiedIntent } from '@/lib/services/voice-intent-classifier';

export type VoiceFeedbackKind = 'idle' | 'listening' | 'recognized' | 'unrecognized';

export interface VoiceFeedbackDisplayState {
  kind: VoiceFeedbackKind;
  /** Normalized transcript to show the user. */
  text?: string;
  confidence?: number;
}

export interface UseVoiceCommandFeedbackOptions {
  manager: VoiceSessionManager;
  latestIntent: ClassifiedIntent | null;
}

export function useVoiceCommandFeedback(
  options: UseVoiceCommandFeedbackOptions,
): VoiceFeedbackDisplayState {
  const { manager, latestIntent } = options;
  const [managerState, setManagerState] = useState<VoiceSessionState>(manager.getState());

  useEffect(() => {
    const off = manager.onStateChange(setManagerState);
    return () => {
      off();
    };
  }, [manager]);

  return useMemo<VoiceFeedbackDisplayState>(() => {
    if (managerState === 'idle' || managerState === 'disabled') {
      return { kind: 'idle' };
    }
    if (managerState === 'speaking') {
      // Visually identical to listening for the user's purposes — mic is
      // hot from their perspective even though we gate the transcript.
      return { kind: 'listening' };
    }
    if (latestIntent) {
      if (
        latestIntent.intent !== 'none' &&
        latestIntent.confidence >= CONFIDENCE_THRESHOLD
      ) {
        return {
          kind: 'recognized',
          text: latestIntent.normalized,
          confidence: latestIntent.confidence,
        };
      }
      if (latestIntent.normalized) {
        return {
          kind: 'unrecognized',
          text: latestIntent.normalized,
          confidence: latestIntent.confidence,
        };
      }
    }
    return { kind: 'listening' };
  }, [managerState, latestIntent]);
}

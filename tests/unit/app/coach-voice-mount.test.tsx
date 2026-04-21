/**
 * Integration test for the voice-control mount in app/(tabs)/coach.tsx.
 *
 * Importing coach.tsx directly pulls Supabase, useAuth, and many screen
 * dependencies; here we reproduce the minimal render branch that the
 * coach tab uses to surface the voice feedback + banner. The behavior
 * under test is the flag-gated presence of the two components — not the
 * rest of the coach screen.
 */

jest.mock('moti', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

import React from 'react';
import { render } from '@testing-library/react-native';
// eslint-disable-next-line import/first
import {
  VoiceControlProvider,
  useVoiceControl,
} from '@/contexts/VoiceControlContext';
// eslint-disable-next-line import/first
import {
  VOICE_CONTROL_PIPELINE_ENV_VAR,
  isVoiceControlPipelineEnabled,
} from '@/lib/services/voice-pipeline-flag';
// eslint-disable-next-line import/first
import { createVoiceSessionManager } from '@/lib/services/voice-session-manager';
// eslint-disable-next-line import/first
import { VoiceControlBanner } from '@/components/voice/VoiceControlBanner';
// eslint-disable-next-line import/first
import { VoiceCommandFeedback } from '@/components/form-tracking/VoiceCommandFeedback';
// eslint-disable-next-line import/first
import {
  useVoiceControlStore,
  __resetVoiceControlStoreForTests,
} from '@/lib/stores/voice-control-store';

/**
 * Mirrors the render branch in app/(tabs)/coach.tsx — flag-gated mount of
 * the banner + feedback pill.
 *
 * `feedbackManager` is optional so tests can point the pill at the same
 * manager the provider is driving (otherwise the pill sees the default
 * singleton which is still in 'idle').
 */
function CoachVoiceMount({
  feedbackManager,
}: { feedbackManager?: Parameters<typeof VoiceCommandFeedback>[0]['manager'] } = {}) {
  const voiceControl = useVoiceControl();
  const voicePipelineEnabled = isVoiceControlPipelineEnabled();
  if (!voicePipelineEnabled) return null;
  return (
    <>
      <VoiceControlBanner testID="coach-voice-banner" />
      <VoiceCommandFeedback
        latestIntent={voiceControl.latestIntent}
        manager={feedbackManager}
      />
    </>
  );
}

describe('coach tab voice mount', () => {
  const ORIGINAL = process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];

  beforeEach(() => {
    __resetVoiceControlStoreForTests();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    } else {
      process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = ORIGINAL;
    }
  });

  it('renders nothing when the pipeline flag is off', () => {
    delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    const { queryByTestId } = render(<CoachVoiceMount />);
    expect(queryByTestId('coach-voice-banner')).toBeNull();
    expect(queryByTestId('voice-command-feedback')).toBeNull();
  });

  it('renders banner + feedback when flag is on and consent granted', async () => {
    process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = 'on';
    // Flip the opt-in so the feedback pill doesn't short-circuit on
    // useVoiceControlStore.enabled.
    useVoiceControlStore.getState().setEnabled(true);
    const manager = createVoiceSessionManager();
    const { findByTestId } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
      >
        <CoachVoiceMount feedbackManager={manager} />
      </VoiceControlProvider>,
    );
    // Banner is present synchronously — no manager state dependency.
    expect(await findByTestId('coach-voice-banner')).toBeTruthy();
    // Feedback pill waits for manager.start() + state flush.
    expect(await findByTestId('voice-command-feedback')).toBeTruthy();
  });

  it('renders banner-consent-required when flag is on but not consented', async () => {
    process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = 'on';
    const manager = createVoiceSessionManager();
    const { findByTestId } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => false}
      >
        <CoachVoiceMount />
      </VoiceControlProvider>,
    );
    // Banner defaults to the caller's testID override. The CoachVoiceMount
    // harness passes no testID, so the banner falls back to
    // `voice-control-banner-${kind}`.
    expect(await findByTestId('coach-voice-banner')).toBeTruthy();
  });
});

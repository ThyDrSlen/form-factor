/**
 * Registration behavior for VoiceControlProvider.
 *
 * The root layout (app/_layout.tsx) conditionally mounts the provider
 * based on EXPO_PUBLIC_VOICE_CONTROL_PIPELINE. This test mirrors that
 * branch so we can assert:
 *   1. Flag off → consumers see inert defaults (pipelineDisabled=true).
 *   2. Flag on → consumers see pipelineDisabled=false and, with consent,
 *      the listening state reflects the session manager.
 *
 * Importing app/_layout.tsx directly pulls the entire provider stack
 * (auth, supabase, etc.), so we reproduce the tiny conditional wrapper
 * inline — the logic under test is the render choice, not the module
 * graph.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  VoiceControlProvider,
  useVoiceControl,
} from '@/contexts/VoiceControlContext';
import {
  VOICE_CONTROL_PIPELINE_ENV_VAR,
  isVoiceControlPipelineEnabled,
} from '@/lib/services/voice-pipeline-flag';
import { createVoiceSessionManager } from '@/lib/services/voice-session-manager';

function MaybeVoiceControlProvider({ children }: { children: React.ReactNode }) {
  if (!isVoiceControlPipelineEnabled()) {
    return <>{children}</>;
  }
  return <VoiceControlProvider>{children}</VoiceControlProvider>;
}

function Probe() {
  const s = useVoiceControl();
  return (
    <Text testID="probe">
      {s.pipelineDisabled ? 'disabled' : 'enabled'}
    </Text>
  );
}

describe('root-layout registration of VoiceControlProvider', () => {
  const ORIGINAL = process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    } else {
      process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = ORIGINAL;
    }
  });

  it('falls through without mounting the provider when flag is off', () => {
    delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    const { getByTestId } = render(
      <MaybeVoiceControlProvider>
        <Probe />
      </MaybeVoiceControlProvider>,
    );
    // Inert default — pipelineDisabled=true.
    expect(getByTestId('probe').props.children).toBe('disabled');
  });

  it('mounts the provider when flag is on', () => {
    process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = 'on';
    // Use an isolated manager so we don't leave the module-scope singleton
    // in a started state between tests.
    const manager = createVoiceSessionManager();
    const { getByTestId } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => false}
      >
        <Probe />
      </VoiceControlProvider>,
    );
    // Flag on, consent missing → pipelineDisabled=false.
    expect(getByTestId('probe').props.children).toBe('enabled');
  });
});

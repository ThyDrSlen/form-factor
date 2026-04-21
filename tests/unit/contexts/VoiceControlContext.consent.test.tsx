/**
 * Consent-gating behavior for VoiceControlContext.
 *
 * Separate from the general lifecycle test (VoiceControlContext.test.tsx)
 * so the consent contract — "never start the manager without explicit
 * opt-in, and reflect consent changes reactively" — is exercised in
 * isolation.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  VoiceControlProvider,
  useVoiceControl,
} from '@/contexts/VoiceControlContext';
import {
  createVoiceSessionManager,
  type VoiceSessionManager,
} from '@/lib/services/voice-session-manager';
import {
  useVoiceControlStore,
  __resetVoiceControlStoreForTests,
} from '@/lib/stores/voice-control-store';
import { hasConsented } from '@/lib/services/voice-privacy-policy';

function Probe({ onState }: { onState: (s: ReturnType<typeof useVoiceControl>) => void }) {
  const state = useVoiceControl();
  onState(state);
  return <Text testID="probe">{state.consentRequired ? 'consent' : 'ok'}</Text>;
}

describe('VoiceControlContext — privacy consent gate', () => {
  beforeEach(() => {
    __resetVoiceControlStoreForTests();
  });

  it('voice-privacy-policy.hasConsented() mirrors the store opt-in', () => {
    expect(hasConsented()).toBe(false);
    useVoiceControlStore.getState().setEnabled(true);
    expect(hasConsented()).toBe(true);
    useVoiceControlStore.getState().setEnabled(false);
    expect(hasConsented()).toBe(false);
  });

  it('exposes consentRequired=true when flag is on but consent missing', () => {
    const manager = createVoiceSessionManager();
    let observed: ReturnType<typeof useVoiceControl> | null =
      null as ReturnType<typeof useVoiceControl> | null;

    render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
      >
        <Probe onState={(s) => { observed = s; }} />
      </VoiceControlProvider>,
    );
    expect(observed?.consentRequired).toBe(true);
    expect(observed?.isListening).toBe(false);
    expect(manager.getState()).toBe('idle');
  });

  it('exposes consentRequired=false + starts the manager once consent flips on', async () => {
    const manager = createVoiceSessionManager();
    const startSpy = jest.spyOn(manager, 'start');
    let observed: ReturnType<typeof useVoiceControl> | null =
      null as ReturnType<typeof useVoiceControl> | null;

    const { rerender: _rerender } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
      >
        <Probe onState={(s) => { observed = s; }} />
      </VoiceControlProvider>,
    );
    expect(startSpy).not.toHaveBeenCalled();

    await act(async () => {
      useVoiceControlStore.getState().setEnabled(true);
    });

    expect(observed?.consentRequired).toBe(false);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toBe('listening');
  });

  it('stops the manager when the user revokes consent', async () => {
    const manager: VoiceSessionManager = createVoiceSessionManager();
    const stopSpy = jest.spyOn(manager, 'stop');
    useVoiceControlStore.getState().setEnabled(true);

    render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
      >
        <Text>probe</Text>
      </VoiceControlProvider>,
    );
    expect(manager.getState()).toBe('listening');

    await act(async () => {
      useVoiceControlStore.getState().setEnabled(false);
    });

    expect(stopSpy).toHaveBeenCalled();
    expect(manager.getState()).toBe('idle');
  });

  it('keeps consentRequired=false when the master flag is off', () => {
    const manager = createVoiceSessionManager();
    let observed: ReturnType<typeof useVoiceControl> | null =
      null as ReturnType<typeof useVoiceControl> | null;

    render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => false}
      >
        <Probe onState={(s) => { observed = s; }} />
      </VoiceControlProvider>,
    );
    // When the pipeline is off, the consent prompt isn't shown either —
    // there's nothing for the user to consent to.
    expect(observed?.consentRequired).toBe(false);
    expect(observed?.pipelineDisabled).toBe(true);
  });
});

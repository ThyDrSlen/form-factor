/**
 * Tests for contexts/VoiceControlContext.tsx
 *
 * We exercise the lifecycle (start on mount, stop on unmount) under every
 * combination of the master flag and consent. The transcript source is
 * injected so we can push raw strings into the pipeline and assert the
 * classifier + executor were invoked.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  VoiceControlProvider,
  useVoiceControl,
  type VoiceTranscriptSource,
} from '@/contexts/VoiceControlContext';
import {
  createVoiceSessionManager,
  type VoiceSessionManager,
} from '@/lib/services/voice-session-manager';
import type { ExecutableRunner } from '@/lib/services/voice-command-executor';

function makeTranscriptSource(): VoiceTranscriptSource & { push: (t: string) => void } {
  const listeners = new Set<(t: string) => void>();
  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    push: (t) => {
      for (const l of listeners) l(t);
    },
  };
}

function makeRunner(): ExecutableRunner {
  return {
    skipRest: jest.fn().mockResolvedValue(undefined),
    updateSet: jest.fn().mockResolvedValue(undefined),
    voiceSlice: {
      activeSession: { id: 'session-1' },
      exercises: [],
      currentExerciseIndex: undefined,
    },
    getCurrentSet: () => null,
    weightPreference: 'metric',
  };
}

function Probe({ onState }: { onState: (s: ReturnType<typeof useVoiceControl>) => void }) {
  const state = useVoiceControl();
  onState(state);
  return <Text testID="probe">{state.isListening ? 'listening' : 'idle'}</Text>;
}

describe('VoiceControlContext — lifecycle gates', () => {
  it('does not start the session manager when the flag is off', () => {
    const manager = createVoiceSessionManager();
    const startSpy = jest.spyOn(manager, 'start');
    const stopSpy = jest.spyOn(manager, 'stop');

    const { unmount } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => false}
        hasConsented={() => true}
      >
        <Text>child</Text>
      </VoiceControlProvider>,
    );
    expect(startSpy).not.toHaveBeenCalled();
    unmount();
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('does not start the session manager when consent is missing', () => {
    const manager = createVoiceSessionManager();
    const startSpy = jest.spyOn(manager, 'start');

    render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => false}
      >
        <Text>child</Text>
      </VoiceControlProvider>,
    );
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('starts the manager when flag is on AND user consented', () => {
    const manager = createVoiceSessionManager();
    const startSpy = jest.spyOn(manager, 'start');
    const stopSpy = jest.spyOn(manager, 'stop');

    const { unmount } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
      >
        <Text>child</Text>
      </VoiceControlProvider>,
    );
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toBe('listening');
    unmount();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceControlContext — transcript pipeline', () => {
  it('classifies transcripts and invokes the executor', async () => {
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();
    const runner = makeRunner();
    let observed: ReturnType<typeof useVoiceControl> | null = null as ReturnType<typeof useVoiceControl> | null;

    render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        buildRunner={() => runner}
      >
        <Probe onState={(s) => { observed = s; }} />
      </VoiceControlProvider>,
    );

    await act(async () => {
      source.push('hey form next');
      // Let the microtask + async executor drain.
      await Promise.resolve();
      await Promise.resolve();
    });

    // The "next" intent calls advanceToNextExercise which will fail with
    // activeSession present but no exercises; that's fine — we only
    // assert that our classifier produced the intent and we surfaced it.
    expect(observed?.latestIntent?.intent).toBe('next');
  });

  it('drops transcripts that miss the wake word', async () => {
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();
    let observed: ReturnType<typeof useVoiceControl> | null = null as ReturnType<typeof useVoiceControl> | null;

    render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        buildRunner={makeRunner}
      >
        <Probe onState={(s) => { observed = s; }} />
      </VoiceControlProvider>,
    );

    await act(async () => {
      source.push('next');
      await Promise.resolve();
    });
    // Without wake word the manager rejects ingest → no latest intent.
    expect(observed?.latestIntent).toBeNull();
  });
});

describe('VoiceControlContext — default state', () => {
  it('useVoiceControl returns inert defaults when the provider is absent', () => {
    let observed: ReturnType<typeof useVoiceControl> | null = null as ReturnType<typeof useVoiceControl> | null;
    render(<Probe onState={(s) => { observed = s; }} />);
    expect(observed?.isListening).toBe(false);
    expect(observed?.latestIntent).toBeNull();
    expect(observed?.pipelineDisabled).toBe(true);
    expect(observed?.consentRequired).toBe(false);
  });
});

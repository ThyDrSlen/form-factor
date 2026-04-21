/**
 * Integration test — voice-control pipeline v1 (wave 24 PR-β)
 *
 * Exercises the full path:
 *   raw transcript  →  voice-session-manager ingest (wake-word gate)
 *                     →  classifyIntentWithFallback (regex + optional Gemma)
 *                     →  executeIntent (ExecutableRunner adapter)
 *
 * The session manager + classifier + executor are the real modules; only
 * the Gemma dispatcher and the runner are mocked so we can assert their
 * arguments precisely.
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

// Mock coach-service so the Gemma NLU fallback branch in
// classifyIntentWithFallback returns a controlled reply. Hoisted.
jest.mock('@/lib/services/coach-service', () => {
  const fn = jest.fn().mockResolvedValue({
    role: 'assistant',
    content: 'next',
  });
  return {
    sendCoachPrompt: fn,
    __fn: fn,
  };
});

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
// eslint-disable-next-line import/first
import {
  VoiceControlProvider,
  useVoiceControl,
  type VoiceTranscriptSource,
} from '@/contexts/VoiceControlContext';
// eslint-disable-next-line import/first
import { createVoiceSessionManager } from '@/lib/services/voice-session-manager';
// eslint-disable-next-line import/first
import type { ExecutableRunner } from '@/lib/services/voice-command-executor';
// eslint-disable-next-line import/first
import type { ClassifiedIntent } from '@/lib/services/voice-intent-classifier';
// eslint-disable-next-line import/first
import { VOICE_CONTROL_PIPELINE_ENV_VAR } from '@/lib/services/voice-pipeline-flag';
// eslint-disable-next-line import/first
import {
  __resetVoiceControlStoreForTests,
  useVoiceControlStore,
} from '@/lib/stores/voice-control-store';

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

interface RunnerMock extends ExecutableRunner {
  skipRest: jest.Mock<Promise<void>, []>;
  updateSet: jest.Mock<Promise<void>, [string, Partial<Record<string, unknown>>]>;
}

function makeRunnerMock(): RunnerMock {
  return {
    skipRest: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    updateSet: jest
      .fn<Promise<void>, [string, Partial<Record<string, unknown>>]>()
      .mockResolvedValue(undefined),
    voiceSlice: {
      activeSession: { id: 'session-42' },
      exercises: [],
      currentExerciseIndex: undefined,
    },
    getCurrentSet: () =>
      ({
        id: 'set-1',
        planned_weight: 60,
        actual_weight: 60,
        perceived_rpe: null,
      }) as unknown as ReturnType<ExecutableRunner['getCurrentSet']>,
    weightPreference: 'metric',
  };
}

function Probe({ onState }: { onState: (s: ReturnType<typeof useVoiceControl>) => void }) {
  const state = useVoiceControl();
  onState(state);
  return <Text testID="probe">{state.isListening ? 'on' : 'off'}</Text>;
}

async function flush() {
  // Drain the chain: microtask (ingestTranscript queueMicrotask) + awaited
  // classifyIntentWithFallback + executeIntent + React state flush.
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

describe('voice pipeline — integration', () => {
  const ORIGINAL = process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];

  beforeEach(() => {
    __resetVoiceControlStoreForTests();
    useVoiceControlStore.getState().setEnabled(true); // grant consent
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    } else {
      process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = ORIGINAL;
    }
  });

  it('classifies a regex-matched transcript and calls the runner', async () => {
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();
    const runner = makeRunnerMock();
    let lastState: ReturnType<typeof useVoiceControl> | null =
      null as ReturnType<typeof useVoiceControl> | null;

    render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        buildRunner={() => runner}
      >
        <Probe onState={(s) => { lastState = s; }} />
      </VoiceControlProvider>,
    );

    await act(async () => {
      source.push('hey form skip rest');
      await flush();
    });

    expect(lastState?.latestIntent?.intent).toBe('skip_rest');
    expect(runner.skipRest).toHaveBeenCalledTimes(1);
  });

  it('routes low-confidence transcripts through the Gemma NLU fallback', async () => {
    // Feature flag ON — classifyIntentWithFallback delegates on low conf.
    process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = 'on';
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();
    const runner = makeRunnerMock();
    let lastState: ReturnType<typeof useVoiceControl> | null =
      null as ReturnType<typeof useVoiceControl> | null;

    // Access the mocked sendCoachPrompt + reset its call count.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const coachMod = require('@/lib/services/coach-service') as {
      __fn: jest.Mock;
      sendCoachPrompt: jest.Mock;
    };
    coachMod.__fn.mockClear();

    render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        buildRunner={() => runner}
      >
        <Probe onState={(s) => { lastState = s; }} />
      </VoiceControlProvider>,
    );

    await act(async () => {
      // A phrase the regex doesn't recognize with confidence ≥ 0.7.
      source.push('hey form can we move along to the following movement');
      await flush();
    });

    // Regex returned 'none' → fallback fired → Gemma mock was called.
    expect(coachMod.__fn).toHaveBeenCalled();
    const intent = (lastState as ReturnType<typeof useVoiceControl> | null)?.latestIntent as
      | ClassifiedIntent
      | null
      | undefined;
    expect(intent?.intent).toBe('next');
    expect(intent?.confidence).toBeGreaterThanOrEqual(0.7);
    // Gemma pins the confidence to the sub-module constant (0.80).
    expect(intent?.confidence).toBeLessThan(1);
  });

  it('drops transcripts that miss the wake word before hitting the classifier', async () => {
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();
    const runner = makeRunnerMock();
    let lastState: ReturnType<typeof useVoiceControl> | null =
      null as ReturnType<typeof useVoiceControl> | null;

    render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        buildRunner={() => runner}
      >
        <Probe onState={(s) => { lastState = s; }} />
      </VoiceControlProvider>,
    );

    await act(async () => {
      source.push('skip rest'); // no wake word
      await flush();
    });

    expect(lastState?.latestIntent).toBeNull();
    expect(runner.skipRest).not.toHaveBeenCalled();
  });

  it('does not start the manager when consent is missing', () => {
    __resetVoiceControlStoreForTests(); // revoke
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();

    render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => false}
      >
        <Probe onState={() => undefined} />
      </VoiceControlProvider>,
    );
    expect(manager.getState()).toBe('idle');
  });
});

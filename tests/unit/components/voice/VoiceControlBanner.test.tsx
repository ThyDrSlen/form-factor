/**
 * Tests for components/voice/VoiceControlBanner.tsx
 *
 * We drive the banner via a stub VoiceControlProvider that publishes a
 * fixed state object — this keeps the component test independent from
 * the session manager and classifier.
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

import React from 'react';
import { render } from '@testing-library/react-native';
// eslint-disable-next-line import/first
import {
  VoiceControlProvider,
  type VoiceTranscriptSource,
} from '@/contexts/VoiceControlContext';
// eslint-disable-next-line import/first
import { createVoiceSessionManager } from '@/lib/services/voice-session-manager';
// eslint-disable-next-line import/first
import { VoiceControlBanner } from '@/components/voice/VoiceControlBanner';
// eslint-disable-next-line import/first
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
      activeSession: { id: 's1' },
      exercises: [],
      currentExerciseIndex: undefined,
    },
    getCurrentSet: () => null,
    weightPreference: 'metric',
  };
}

describe('VoiceControlBanner', () => {
  it('renders nothing when the pipeline is disabled', () => {
    const { queryByTestId } = render(<VoiceControlBanner />);
    expect(queryByTestId(/voice-control-banner-/)).toBeNull();
  });

  it('shows consent-required when flag is on but user has not opted in', () => {
    const manager = createVoiceSessionManager();
    const { queryByTestId } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => false}
      >
        <VoiceControlBanner />
      </VoiceControlProvider>,
    );
    expect(queryByTestId('voice-control-banner-consent-required')).toBeTruthy();
  });

  it('shows listening state when manager is listening and no intent yet', () => {
    const manager = createVoiceSessionManager();
    const { getByTestId } = render(
      <VoiceControlProvider
        manager={manager}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        transcriptSource={makeTranscriptSource()}
        buildRunner={makeRunner}
      >
        <VoiceControlBanner />
      </VoiceControlProvider>,
    );
    // Manager transitions to 'listening' on provider mount when consented.
    expect(getByTestId('voice-control-banner-listening')).toBeTruthy();
  });

  it('shows processing state when a classified intent is present', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    const manager = createVoiceSessionManager();
    const source = makeTranscriptSource();
    const runner = makeRunner();

    const { findByTestId } = render(
      <VoiceControlProvider
        manager={manager}
        transcriptSource={source}
        isPipelineEnabled={() => true}
        hasConsented={() => true}
        buildRunner={() => runner}
      >
        <VoiceControlBanner />
      </VoiceControlProvider>,
    );

    source.push('hey form next');
    const banner = await findByTestId('voice-control-banner-processing');
    expect(banner).toBeTruthy();
    jest.useRealTimers();
  });
});


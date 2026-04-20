/**
 * Tests for components/form-tracking/VoiceCommandFeedback.tsx
 *
 * We stub expo-haptics and the voice-session-manager to keep the test
 * hermetic. The shared useVoiceControlStore from the real module is used
 * with its test-reset helper.
 */

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { VoiceCommandFeedback } from '@/components/form-tracking/VoiceCommandFeedback';
import {
  useVoiceControlStore,
  __resetVoiceControlStoreForTests,
} from '@/lib/stores/voice-control-store';
import type { VoiceSessionManager, VoiceSessionState } from '@/lib/services/voice-session-manager';
import type { ClassifiedIntent } from '@/lib/services/voice-intent-classifier';

// Minimal manager that tests can drive
function makeManager(initialState: VoiceSessionState = 'listening'): VoiceSessionManager & {
  _set: (s: VoiceSessionState) => void;
} {
  let state: VoiceSessionState = initialState;
  const listeners = new Set<(s: VoiceSessionState) => void>();
  return {
    getState: () => state,
    start: jest.fn(),
    stop: jest.fn(),
    ingestTranscript: jest.fn(() => null),
    onCuePlaybackStart: jest.fn(),
    onCuePlaybackEnd: jest.fn(),
    onStateChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    _set: (s) => {
      state = s;
      listeners.forEach((l) => l(s));
    },
  };
}

const goodIntent: ClassifiedIntent = {
  intent: 'next',
  params: {},
  confidence: 0.95,
  normalized: 'next',
};

const badIntent: ClassifiedIntent = {
  intent: 'none',
  params: {},
  confidence: 0.4,
  normalized: 'bananarama',
};

beforeEach(() => {
  __resetVoiceControlStoreForTests();
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ===========================================================================
// Gating via useVoiceControlStore.enabled
// ===========================================================================

describe('gating', () => {
  it('renders nothing when enabled=false', () => {
    const { queryByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('listening')} latestIntent={null} />,
    );
    expect(queryByTestId('voice-command-feedback')).toBeNull();
  });

  it('renders nothing when manager state is idle even if enabled', () => {
    act(() => {
      useVoiceControlStore.getState().setEnabled(true);
    });
    const { queryByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('idle')} latestIntent={null} />,
    );
    expect(queryByTestId('voice-command-feedback')).toBeNull();
  });
});

// ===========================================================================
// Listening state
// ===========================================================================

describe('listening', () => {
  beforeEach(() => {
    act(() => {
      useVoiceControlStore.getState().setEnabled(true);
    });
  });

  it('renders "Listening…" label when manager is listening', () => {
    const { getByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('listening')} latestIntent={null} />,
    );
    expect(getByTestId('voice-feedback-label').props.children).toBe('Listening…');
  });

  it('also renders listening label when manager is speaking (duplex)', () => {
    const { getByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('speaking')} latestIntent={null} />,
    );
    expect(getByTestId('voice-feedback-label').props.children).toBe('Listening…');
  });
});

// ===========================================================================
// Recognized state
// ===========================================================================

describe('recognized', () => {
  beforeEach(() => {
    act(() => {
      useVoiceControlStore.getState().setEnabled(true);
    });
  });

  it('renders "Got it" and the transcript on recognized intent', () => {
    const { getByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('processing')} latestIntent={goodIntent} />,
    );
    expect(getByTestId('voice-feedback-label').props.children).toBe('Got it');
    expect(getByTestId('voice-feedback-transcript').props.children).toBe('next');
  });

  it('fires medium haptic on recognized', () => {
    render(<VoiceCommandFeedback manager={makeManager('processing')} latestIntent={goodIntent} />);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });
});

// ===========================================================================
// Unrecognized state
// ===========================================================================

describe('unrecognized', () => {
  beforeEach(() => {
    act(() => {
      useVoiceControlStore.getState().setEnabled(true);
    });
  });

  it('renders "Didn\'t catch that" when intent is none with non-empty transcript', () => {
    const { getByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('processing')} latestIntent={badIntent} />,
    );
    expect(getByTestId('voice-feedback-label').props.children).toBe("Didn't catch that");
    expect(getByTestId('voice-feedback-transcript').props.children).toBe('bananarama');
  });
});

// ===========================================================================
// Auto-dismiss
// ===========================================================================

describe('auto-dismiss', () => {
  beforeEach(() => {
    act(() => {
      useVoiceControlStore.getState().setEnabled(true);
    });
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('high-confidence pill dismisses after 2s', () => {
    const { queryByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('processing')} latestIntent={goodIntent} />,
    );
    expect(queryByTestId('voice-command-feedback')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(2100);
    });
    expect(queryByTestId('voice-command-feedback')).toBeNull();
  });

  it('low-confidence pill persists longer (4s dismiss)', () => {
    const lowConf: ClassifiedIntent = { ...badIntent, confidence: 0.5 };
    const { queryByTestId } = render(
      <VoiceCommandFeedback manager={makeManager('processing')} latestIntent={lowConf} />,
    );
    expect(queryByTestId('voice-command-feedback')).toBeTruthy();
    // 2.5s — high-conf timer would have fired; low-conf must not yet.
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(queryByTestId('voice-command-feedback')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(queryByTestId('voice-command-feedback')).toBeNull();
  });
});

// ===========================================================================
// Manager state listener
// ===========================================================================

describe('manager state listener', () => {
  beforeEach(() => {
    act(() => {
      useVoiceControlStore.getState().setEnabled(true);
    });
  });

  it('updates when manager state changes', () => {
    const mgr = makeManager('listening');
    const { queryByTestId, getByTestId } = render(
      <VoiceCommandFeedback manager={mgr} latestIntent={null} />,
    );
    expect(getByTestId('voice-feedback-label').props.children).toBe('Listening…');
    act(() => {
      mgr._set('idle');
    });
    expect(queryByTestId('voice-command-feedback')).toBeNull();
  });
});

// Prevent "unused import" warnings where the fireEvent helper isn't called.
void fireEvent;

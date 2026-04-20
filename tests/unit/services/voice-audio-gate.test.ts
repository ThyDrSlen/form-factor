/**
 * Tests for lib/services/voice-audio-gate.ts
 *
 * We inject a stub audioManager so the test is hermetic — production
 * audioSessionManager uses expo-av which is not available in Jest JSDom.
 */

// Mock the real audio-session-manager module so importing voice-audio-gate
// doesn't pull in expo-av.
jest.mock('@/lib/services/audio-session-manager', () => ({
  audioSessionManager: {
    getMode: jest.fn(() => 'idle'),
    onModeChange: jest.fn(() => () => {}),
  },
}));

import { createVoiceAudioGate } from '@/lib/services/voice-audio-gate';
import type { VoiceSessionManager } from '@/lib/services/voice-session-manager';

function makeManagerStub(): VoiceSessionManager {
  return {
    getState: jest.fn(() => 'idle'),
    start: jest.fn(),
    stop: jest.fn(),
    ingestTranscript: jest.fn(() => null),
    onCuePlaybackStart: jest.fn(),
    onCuePlaybackEnd: jest.fn(),
    onStateChange: jest.fn(() => () => {}),
  };
}

type Mode = 'idle' | 'tracking' | 'coaching';

function makeAudioStub(initialMode: Mode = 'idle') {
  let mode: Mode = initialMode;
  const listeners = new Set<(m: Mode) => void>();
  return {
    getMode: jest.fn(() => mode),
    onModeChange: jest.fn((cb: (m: Mode) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
    // Test-only helper for firing transitions
    _fire: (next: Mode) => {
      mode = next;
      listeners.forEach((l) => l(next));
    },
    _listenerCount: () => listeners.size,
  };
}

// ===========================================================================
// Observer path
// ===========================================================================

describe('createVoiceAudioGate — observer path', () => {
  it('subscribes to onModeChange when available', () => {
    const audio = makeAudioStub('idle');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    expect(audio.onModeChange).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it('forwards idle → tracking as onCuePlaybackStart', () => {
    const audio = makeAudioStub('idle');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    audio._fire('tracking');
    expect(manager.onCuePlaybackStart).toHaveBeenCalledTimes(1);
    expect(manager.onCuePlaybackEnd).not.toHaveBeenCalled();
    gate.dispose();
  });

  it('forwards tracking → idle as onCuePlaybackEnd', () => {
    const audio = makeAudioStub('tracking');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    audio._fire('idle');
    expect(manager.onCuePlaybackEnd).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it('forwards tracking → coaching as onCuePlaybackEnd', () => {
    const audio = makeAudioStub('tracking');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    audio._fire('coaching');
    expect(manager.onCuePlaybackEnd).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it('ignores same-mode transitions', () => {
    const audio = makeAudioStub('idle');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    audio._fire('idle');
    audio._fire('idle');
    expect(manager.onCuePlaybackStart).not.toHaveBeenCalled();
    expect(manager.onCuePlaybackEnd).not.toHaveBeenCalled();
    gate.dispose();
  });

  it('dispose unsubscribes listener', () => {
    const audio = makeAudioStub('idle');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    expect(audio._listenerCount()).toBe(1);
    gate.dispose();
    expect(audio._listenerCount()).toBe(0);
  });

  it('handles double dispose gracefully', () => {
    const audio = makeAudioStub('idle');
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({ manager, audioManager: audio });
    gate.dispose();
    expect(() => gate.dispose()).not.toThrow();
  });
});

// ===========================================================================
// Polling fallback path
// ===========================================================================

describe('createVoiceAudioGate — polling fallback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls when audioManager lacks onModeChange', () => {
    let currentMode: Mode = 'idle';
    const stub = {
      getMode: jest.fn(() => currentMode),
      // intentionally no onModeChange
    };
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({
      manager,
      audioManager: stub,
      pollIntervalMs: 100,
    });

    // Simulate cue start after 100ms
    currentMode = 'tracking';
    jest.advanceTimersByTime(100);
    expect(manager.onCuePlaybackStart).toHaveBeenCalledTimes(1);

    // Simulate cue end
    currentMode = 'idle';
    jest.advanceTimersByTime(100);
    expect(manager.onCuePlaybackEnd).toHaveBeenCalledTimes(1);

    gate.dispose();
  });

  it('dispose clears polling interval', () => {
    const stub = {
      getMode: jest.fn(() => 'idle' as Mode),
    };
    const manager = makeManagerStub();
    const gate = createVoiceAudioGate({
      manager,
      audioManager: stub,
      pollIntervalMs: 100,
    });
    gate.dispose();
    // After dispose, further ticks must not query the stub.
    const callsBefore = (stub.getMode as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(500);
    expect((stub.getMode as jest.Mock).mock.calls.length).toBe(callsBefore);
  });
});

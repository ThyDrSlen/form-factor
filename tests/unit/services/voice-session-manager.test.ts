/**
 * Tests for lib/services/voice-session-manager.ts
 */

import {
  createVoiceSessionManager,
  checkWakeWord,
  WAKE_WORD_TOKENS,
} from '@/lib/services/voice-session-manager';

// ===========================================================================
// checkWakeWord — pure helper
// ===========================================================================

describe('checkWakeWord', () => {
  it('accepts "hey form next" and strips the prefix', () => {
    const r = checkWakeWord('hey form next');
    expect(r.accepted).toBe(true);
    expect(r.stripped).toBe('next');
    expect(r.wakeWord).toBe('hey form');
  });

  it('accepts "Hey Coach pause" case-insensitively', () => {
    const r = checkWakeWord('Hey Coach pause');
    expect(r.accepted).toBe(true);
    expect(r.stripped).toBe('pause');
    expect(r.wakeWord).toBe('hey coach');
  });

  it('accepts bare "coach" prefix', () => {
    const r = checkWakeWord('coach skip rest');
    expect(r.accepted).toBe(true);
    expect(r.stripped).toBe('skip rest');
    expect(r.wakeWord).toBe('coach');
  });

  it('accepts wake word followed by a comma', () => {
    const r = checkWakeWord('Hey form, resume');
    expect(r.accepted).toBe(true);
    expect(r.stripped).toBe('resume');
  });

  it('rejects transcript without wake word', () => {
    const r = checkWakeWord('next exercise');
    expect(r.accepted).toBe(false);
    expect(r.wakeWord).toBeNull();
  });

  it('rejects empty transcript', () => {
    expect(checkWakeWord('').accepted).toBe(false);
    expect(checkWakeWord('   ').accepted).toBe(false);
  });

  it('does not match "coaches" as "coach"', () => {
    const r = checkWakeWord('coaches are great');
    expect(r.accepted).toBe(false);
  });

  it('handles extra whitespace inside wake-word phrase', () => {
    const r = checkWakeWord('hey   form   pause');
    expect(r.accepted).toBe(true);
    expect(r.stripped).toBe('pause');
  });

  it('exports WAKE_WORD_TOKENS as a readonly tuple of recognized tokens', () => {
    expect(WAKE_WORD_TOKENS).toEqual(['hey form', 'hey coach', 'coach']);
  });
});

// ===========================================================================
// State machine
// ===========================================================================

describe('createVoiceSessionManager — state machine', () => {
  it('starts in idle', () => {
    const mgr = createVoiceSessionManager();
    expect(mgr.getState()).toBe('idle');
  });

  it('idle → listening on start()', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    expect(mgr.getState()).toBe('listening');
  });

  it('listening → idle on stop()', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    mgr.stop();
    expect(mgr.getState()).toBe('idle');
  });

  it('listening → processing → listening on wake-word transcript (auto-reset)', async () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    const states: string[] = [];
    mgr.onStateChange((s) => states.push(s));

    const stripped = mgr.ingestTranscript('hey form pause');
    expect(stripped).toBe('pause');
    expect(mgr.getState()).toBe('processing');

    // Flush microtasks
    await Promise.resolve();

    expect(mgr.getState()).toBe('listening');
    expect(states).toEqual(['processing', 'listening']);
  });

  it('drops transcripts when not in listening', () => {
    const mgr = createVoiceSessionManager();
    // idle, not started
    expect(mgr.ingestTranscript('hey form next')).toBeNull();
    expect(mgr.getState()).toBe('idle');
  });

  it('drops transcripts without wake word even while listening', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    expect(mgr.ingestTranscript('next')).toBeNull();
    expect(mgr.getState()).toBe('listening');
  });
});

// ===========================================================================
// Duplex gating via cue playback
// ===========================================================================

describe('duplex gating', () => {
  it('onCuePlaybackStart transitions to speaking', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    mgr.onCuePlaybackStart();
    expect(mgr.getState()).toBe('speaking');
  });

  it('drops transcripts while speaking', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    mgr.onCuePlaybackStart();
    const result = mgr.ingestTranscript('hey form next');
    expect(result).toBeNull();
  });

  it('onCuePlaybackEnd returns to listening when user wants it', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    mgr.onCuePlaybackStart();
    expect(mgr.getState()).toBe('speaking');
    mgr.onCuePlaybackEnd();
    expect(mgr.getState()).toBe('listening');
  });

  it('onCuePlaybackEnd returns to idle if user never started', () => {
    const mgr = createVoiceSessionManager();
    mgr.onCuePlaybackStart();
    mgr.onCuePlaybackEnd();
    expect(mgr.getState()).toBe('idle');
  });

  it('start() during speaking does not override cue playback', () => {
    const mgr = createVoiceSessionManager();
    mgr.onCuePlaybackStart();
    mgr.start();
    expect(mgr.getState()).toBe('speaking');
    mgr.onCuePlaybackEnd();
    expect(mgr.getState()).toBe('listening');
  });
});

// ===========================================================================
// Listeners
// ===========================================================================

describe('onStateChange listeners', () => {
  it('fires listener on transitions', () => {
    const mgr = createVoiceSessionManager();
    const spy = jest.fn();
    mgr.onStateChange(spy);
    mgr.start();
    mgr.stop();
    expect(spy).toHaveBeenCalledWith('listening');
    expect(spy).toHaveBeenCalledWith('idle');
  });

  it('unsubscribe prevents further callbacks', () => {
    const mgr = createVoiceSessionManager();
    const spy = jest.fn();
    const off = mgr.onStateChange(spy);
    off();
    mgr.start();
    expect(spy).not.toHaveBeenCalled();
  });

  it('no-op transition (same state) does not notify', () => {
    const mgr = createVoiceSessionManager();
    mgr.start();
    const spy = jest.fn();
    mgr.onStateChange(spy);
    mgr.start(); // already listening
    expect(spy).not.toHaveBeenCalled();
  });
});

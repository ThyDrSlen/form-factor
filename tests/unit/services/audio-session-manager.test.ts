import { Audio } from 'expo-av';
import { AudioSessionManager } from '@/lib/services/audio-session-manager';

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  },
  InterruptionModeIOS: { MixWithOthers: 1, DuckOthers: 2 },
  InterruptionModeAndroid: { DuckOthers: 2 },
}));

const mockSetAudioMode = Audio.setAudioModeAsync as jest.Mock;

let manager: AudioSessionManager;

beforeEach(() => {
  jest.clearAllMocks();
  manager = AudioSessionManager.getInstance();
  // Reset singleton internal state between tests
  (manager as any).currentMode = 'idle';
  (manager as any).listeners = new Set();
  (manager as any).cancelListeners = new Set();
});

// =============================================================================
// getMode
// =============================================================================

describe('getMode', () => {
  it('returns idle initially', () => {
    expect(manager.getMode()).toBe('idle');
  });
});

// =============================================================================
// setMode
// =============================================================================

describe('setMode', () => {
  it('tracking mode calls Audio.setAudioModeAsync with tracking config', async () => {
    await manager.setMode('tracking');

    expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
    const config = mockSetAudioMode.mock.calls[0][0];
    expect(config.allowsRecordingIOS).toBe(false);
    expect(config.staysActiveInBackground).toBe(true);
    expect(config.playsInSilentModeIOS).toBe(true);
    expect(manager.getMode()).toBe('tracking');
  });

  it('coaching mode sets allowsRecordingIOS: true', async () => {
    await manager.setMode('coaching');

    expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
    const config = mockSetAudioMode.mock.calls[0][0];
    expect(config.allowsRecordingIOS).toBe(true);
    expect(config.staysActiveInBackground).toBe(true);
    expect(config.playsInSilentModeIOS).toBe(true);
    expect(manager.getMode()).toBe('coaching');
  });

  it('same mode is a no-op', async () => {
    (manager as any).currentMode = 'tracking';

    await manager.setMode('tracking');

    expect(mockSetAudioMode).not.toHaveBeenCalled();
  });

  it('handles Audio.setAudioModeAsync errors gracefully', async () => {
    mockSetAudioMode.mockRejectedValueOnce(new Error('Audio system error'));

    await manager.setMode('coaching');

    // Mode should NOT change on error
    expect(manager.getMode()).toBe('idle');
  });
});

// =============================================================================
// canRecord
// =============================================================================

describe('canRecord', () => {
  it('returns false in idle', () => {
    expect(manager.canRecord()).toBe(false);
  });

  it('returns false in tracking', async () => {
    await manager.setMode('tracking');
    expect(manager.canRecord()).toBe(false);
  });

  it('returns true in coaching', async () => {
    await manager.setMode('coaching');
    expect(manager.canRecord()).toBe(true);
  });
});

// =============================================================================
// onModeChange
// =============================================================================

describe('onModeChange', () => {
  it('listener fires on mode change', async () => {
    const listener = jest.fn();
    manager.onModeChange(listener);

    await manager.setMode('tracking');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('tracking');
  });

  it('unsubscribe stops listener from firing', async () => {
    const listener = jest.fn();
    const unsubscribe = manager.onModeChange(listener);

    unsubscribe();
    await manager.setMode('coaching');

    expect(listener).not.toHaveBeenCalled();
  });
});

// =============================================================================
// cancel / onCancelRequested
// =============================================================================

describe('cancel', () => {
  it('invokes every registered cancel listener', () => {
    const a = jest.fn();
    const b = jest.fn();
    manager.onCancelRequested(a);
    manager.onCancelRequested(b);

    manager.cancel();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing a cancel listener stops future cancel() fan-out', () => {
    const listener = jest.fn();
    const unsubscribe = manager.onCancelRequested(listener);
    unsubscribe();

    manager.cancel();

    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates throwing listeners so later listeners still run', () => {
    const throwing = jest.fn(() => {
      throw new Error('boom');
    });
    const healthy = jest.fn();
    manager.onCancelRequested(throwing);
    manager.onCancelRequested(healthy);

    expect(() => manager.cancel()).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('no-ops when no cancel listeners are registered', () => {
    expect(() => manager.cancel()).not.toThrow();
  });
});

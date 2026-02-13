import {
  deriveWatchAvailability,
  evaluateFusionCapabilities,
  type CapabilityInput,
} from '@/lib/fusion/capabilities';

describe('fusion capabilities', () => {
  const baseInput: CapabilityInput = {
    cameraAnchorAvailable: true,
    headphoneMotionAvailable: true,
    watch: {
      paired: true,
      installed: true,
      reachable: true,
    },
  };

  test('returns full mode when all required streams are ready', () => {
    const result = evaluateFusionCapabilities(baseInput);

    expect(result.mode).toBe('full');
    expect(result.fallbackModeEnabled).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  test('returns degraded mode when headphone motion is unavailable', () => {
    const result = evaluateFusionCapabilities({
      ...baseInput,
      headphoneMotionAvailable: false,
    });

    expect(result.mode).toBe('degraded');
    expect(result.fallbackModeEnabled).toBe(true);
    expect(result.reasons).toContain('headphone_motion_unavailable');
  });

  test('returns unsupported mode when camera anchor is unavailable', () => {
    const result = evaluateFusionCapabilities({
      ...baseInput,
      cameraAnchorAvailable: false,
    });

    expect(result.mode).toBe('unsupported');
    expect(result.fallbackModeEnabled).toBe(true);
    expect(result.reasons).toContain('camera_anchor_unavailable');
  });

  test('watch availability transitions through deterministic states', () => {
    const states = [
      deriveWatchAvailability({ paired: false, installed: false, reachable: false }).state,
      deriveWatchAvailability({ paired: true, installed: false, reachable: false }).state,
      deriveWatchAvailability({ paired: true, installed: true, reachable: false }).state,
      deriveWatchAvailability({ paired: true, installed: true, reachable: true }).state,
    ];

    expect(states).toEqual(['unavailable', 'paired_only', 'installed_not_reachable', 'ready']);
  });
});

import { isAROverlaysV2Enabled } from '@/lib/services/ar-overlays-v2-flag';

describe('ar-overlays-v2-flag', () => {
  const originalEnv = process.env.EXPO_PUBLIC_AR_OVERLAYS_V2;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXPO_PUBLIC_AR_OVERLAYS_V2;
    } else {
      process.env.EXPO_PUBLIC_AR_OVERLAYS_V2 = originalEnv;
    }
  });

  it('returns false when the env var is unset', () => {
    delete process.env.EXPO_PUBLIC_AR_OVERLAYS_V2;
    expect(isAROverlaysV2Enabled()).toBe(false);
  });

  it('returns true for the literal string "on"', () => {
    process.env.EXPO_PUBLIC_AR_OVERLAYS_V2 = 'on';
    expect(isAROverlaysV2Enabled()).toBe(true);
  });

  it('returns false for "off"', () => {
    process.env.EXPO_PUBLIC_AR_OVERLAYS_V2 = 'off';
    expect(isAROverlaysV2Enabled()).toBe(false);
  });

  it('is strict — does not accept truthy aliases', () => {
    for (const value of ['true', '1', 'yes', 'ON', 'On', 'enabled']) {
      process.env.EXPO_PUBLIC_AR_OVERLAYS_V2 = value;
      expect(isAROverlaysV2Enabled()).toBe(false);
    }
  });
});

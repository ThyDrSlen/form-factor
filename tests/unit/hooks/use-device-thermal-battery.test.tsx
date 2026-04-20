import { renderHook, waitFor } from '@testing-library/react-native';
import {
  deriveBadgeLevel,
  deriveShouldPause,
  useDeviceThermalBattery,
} from '@/hooks/use-device-thermal-battery';
import {
  __setThermalStateForTest,
} from '@/lib/services/thermal-monitor';

afterEach(() => {
  __setThermalStateForTest('normal');
});

describe('deriveBadgeLevel (pure)', () => {
  it('returns "normal" with healthy battery + normal thermal', () => {
    expect(deriveBadgeLevel(0.8, 'normal')).toBe('normal');
  });

  it('returns "warn" when battery < 20% (no thermal pressure)', () => {
    expect(deriveBadgeLevel(0.15, 'normal')).toBe('warn');
  });

  it('returns "warn" when thermal=fair (battery healthy)', () => {
    expect(deriveBadgeLevel(0.8, 'fair')).toBe('warn');
  });

  it('returns "critical" when battery < 10%', () => {
    expect(deriveBadgeLevel(0.05, 'normal')).toBe('critical');
  });

  it('returns "critical" when thermal=serious or critical', () => {
    expect(deriveBadgeLevel(0.8, 'serious')).toBe('critical');
    expect(deriveBadgeLevel(0.8, 'critical')).toBe('critical');
  });

  it('handles a null battery level by relying on thermal alone', () => {
    expect(deriveBadgeLevel(null, 'normal')).toBe('normal');
    expect(deriveBadgeLevel(null, 'fair')).toBe('warn');
    expect(deriveBadgeLevel(null, 'critical')).toBe('critical');
  });

  it('treats edge thresholds correctly (10% and 20%)', () => {
    expect(deriveBadgeLevel(0.1, 'normal')).toBe('warn');
    expect(deriveBadgeLevel(0.2, 'normal')).toBe('normal');
    expect(deriveBadgeLevel(0, 'normal')).toBe('critical');
  });
});

describe('deriveShouldPause (pure)', () => {
  it('returns false on healthy battery + normal thermal', () => {
    expect(deriveShouldPause(0.8, 'normal')).toBe(false);
  });

  it('returns true on critical thermal', () => {
    expect(deriveShouldPause(0.8, 'critical')).toBe(true);
  });

  it('returns true on serious thermal', () => {
    expect(deriveShouldPause(0.8, 'serious')).toBe(true);
  });

  it('returns true when battery < 10%', () => {
    expect(deriveShouldPause(0.05, 'normal')).toBe(true);
    expect(deriveShouldPause(0, 'normal')).toBe(true);
  });

  it('returns false at the 10% boundary', () => {
    expect(deriveShouldPause(0.1, 'normal')).toBe(false);
  });

  it('handles null battery without spuriously pausing', () => {
    expect(deriveShouldPause(null, 'normal')).toBe(false);
    expect(deriveShouldPause(null, 'serious')).toBe(true);
  });
});

describe('useDeviceThermalBattery', () => {
  it('initializes with the current thermal state', async () => {
    __setThermalStateForTest('normal');
    const { result } = renderHook(() => useDeviceThermalBattery());
    await waitFor(() => {
      expect(result.current.thermalState).toBe('normal');
    });
    expect(result.current.badgeLevel).toBe('normal');
    expect(result.current.shouldPauseLowPower).toBe(false);
  });

  it('returns null batteryLevel when expo-battery is not installed', async () => {
    const { result } = renderHook(() => useDeviceThermalBattery());
    // First polling tick should set batteryLevel; the stub will leave it null.
    await waitFor(() => {
      expect(result.current.batteryLevel).toBeNull();
    });
  });
});

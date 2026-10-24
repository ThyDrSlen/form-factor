import { Platform } from 'react-native';
import {
  ThermalMonitor,
  fpsForThermalState,
  readThermalState,
  snapshotFromState,
  strideForFps,
} from '@/lib/services/thermal-monitor';

const mockGetThermalState = jest.fn();
const mockThermalModule = jest.fn();
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (...args: unknown[]) => mockThermalModule(...args),
}));


describe('thermal-monitor', () => {
  it('maps thermal states to FPS buckets', () => {
    expect(fpsForThermalState('nominal')).toBe(60);
    expect(fpsForThermalState('fair')).toBe(60);
    expect(fpsForThermalState('serious')).toBe(30);
    expect(fpsForThermalState('critical')).toBe(15);
  });

  it('computes stride for each fps bucket', () => {
    expect(strideForFps(60)).toBe(1);
    expect(strideForFps(30)).toBe(2);
    expect(strideForFps(15)).toBe(4);
  });

  it('marks throttled=true only for serious/critical', () => {
    expect(snapshotFromState('nominal').throttled).toBe(false);
    expect(snapshotFromState('fair').throttled).toBe(false);
    expect(snapshotFromState('serious').throttled).toBe(true);
    expect(snapshotFromState('critical').throttled).toBe(true);
  });

  describe('native thermal reader', () => {
    const originalPlatform = Platform.OS;
    beforeEach(() => {
      Platform.OS = 'ios';
      mockThermalModule.mockReturnValue({ getThermalState: mockGetThermalState });
      mockGetThermalState.mockReset();
    });
    afterEach(() => { Platform.OS = originalPlatform; });

    it.each(['nominal', 'fair', 'serious', 'critical'])('reads native %s pressure', async state => {
      mockGetThermalState.mockReturnValue(state);
      await expect(readThermalState()).resolves.toBe(state);
    });

    it.each([null, {}])('supports native builds without a thermal reader: %s', async module => {
      mockThermalModule.mockReturnValue(module);
      await expect(readThermalState()).resolves.toBe('nominal');
    });

    it('ignores unrecognized native states', async () => {
      mockGetThermalState.mockReturnValue('unknown');
      await expect(readThermalState()).resolves.toBe('nominal');
    });

    it('does not load the iOS module on other platforms', async () => {
      Platform.OS = 'android';
      mockThermalModule.mockClear();
      await expect(readThermalState()).resolves.toBe('nominal');
      expect(mockThermalModule).not.toHaveBeenCalled();
    });
  });

  it('emits transitions to subscribers', async () => {
    let stateToReturn: 'nominal' | 'serious' = 'nominal';
    const monitor = new ThermalMonitor({
      pollIntervalMs: 1_000_000, // effectively disable auto-polling
      readThermalState: () => stateToReturn,
    });
    const events: string[] = [];
    const unsubscribe = monitor.subscribe((snap) => events.push(snap.state));

    // Immediate fire-on-subscribe
    expect(events).toEqual(['nominal']);

    stateToReturn = 'serious';
    await monitor.refresh();
    expect(events).toEqual(['nominal', 'serious']);

    stateToReturn = 'serious';
    await monitor.refresh();
    // No duplicate emissions when state is unchanged
    expect(events).toEqual(['nominal', 'serious']);

    unsubscribe();
    monitor.dispose();
  });

  it('swallows reader errors without losing last snapshot', async () => {
    const monitor = new ThermalMonitor({
      pollIntervalMs: 1_000_000,
      readThermalState: () => {
        throw new Error('boom');
      },
    });
    expect(monitor.getSnapshot().state).toBe('nominal');
    await expect(monitor.refresh()).resolves.toMatchObject({ state: 'nominal' });
    monitor.dispose();
  });
});

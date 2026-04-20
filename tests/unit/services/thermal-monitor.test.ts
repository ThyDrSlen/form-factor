import {
  ThermalMonitor,
  fpsForThermalState,
  readThermalState,
  snapshotFromState,
  strideForFps,
} from '@/lib/services/thermal-monitor';

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

  it('default reader stubs to nominal', async () => {
    await expect(readThermalState()).resolves.toBe('nominal');
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

/**
 * useAdaptiveFps — dynamic FPS/stride driven by ThermalMonitor.
 *
 * Mounts a ThermalMonitor, subscribes to thermal snapshots, and exposes
 * the current FPS bucket (60/30/15) + stride to the caller. The host
 * screen can feed the stride into its frame loop to skip work when the
 * device is under thermal pressure.
 *
 * iOS reads ProcessInfo.thermalState through the native tracking module.
 * Other platforms and older native builds fall back to nominal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ThermalMonitor,
  snapshotFromState,
  type ThermalMonitorOptions,
  type ThermalSnapshot,
} from '@/lib/services/thermal-monitor';

export type UseAdaptiveFpsOptions = ThermalMonitorOptions & {
  /** Defaults to true. Set false to freeze on 'nominal'. */
  enabled?: boolean;
};

export type UseAdaptiveFpsResult = ThermalSnapshot & {
  /** Returns true once per stride, false otherwise. Used to skip frames. */
  shouldProcessFrame: (frameIndex: number) => boolean;
  /** Force-refresh the thermal reading (useful after returning from background). */
  refresh: () => Promise<void>;
};

export function useAdaptiveFps(options?: UseAdaptiveFpsOptions): UseAdaptiveFpsResult {
  const enabled = options?.enabled ?? true;
  const monitorRef = useRef<ThermalMonitor | null>(null);
  const [snapshot, setSnapshot] = useState<ThermalSnapshot>(() =>
    snapshotFromState('nominal'),
  );

  if (monitorRef.current === null) {
    monitorRef.current = new ThermalMonitor(options);
  }

  useEffect(() => {
    const monitor = monitorRef.current;
    if (!monitor) return;
    if (!enabled) {
      monitor.stop();
      setSnapshot(snapshotFromState('nominal'));
      return;
    }
    monitor.start();
    const unsubscribe = monitor.subscribe((next) => {
      setSnapshot(next);
    });
    return () => {
      unsubscribe();
      monitor.stop();
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      monitorRef.current?.dispose();
      monitorRef.current = null;
    };
  }, []);

  return useMemo<UseAdaptiveFpsResult>(() => {
    const stride = snapshot.stride;
    return {
      ...snapshot,
      shouldProcessFrame: (frameIndex: number) => {
        if (!Number.isFinite(frameIndex) || frameIndex < 0) return true;
        if (stride <= 1) return true;
        return frameIndex % stride === 0;
      },
      refresh: async () => {
        const monitor = monitorRef.current;
        if (!monitor) return;
        const next = await monitor.refresh();
        setSnapshot(next);
      },
    };
  }, [snapshot]);
}

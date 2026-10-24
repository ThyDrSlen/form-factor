import { useEffect, useState } from 'react';
import { listProviders } from '@/lib/ai/registry';

export type OnDeviceModelStatus = 'none' | 'downloading' | 'ready' | 'error';

export interface OnDeviceModelState {
  status: OnDeviceModelStatus;
  /** Label of the registered on-device provider, when there is one. */
  modelId?: string;
  progress?: number;
  errorMessage?: string;
}

/**
 * Status of the on-device model for Settings → Coaching. `none` until an
 * on-device runtime registers a provider (see lib/ai/providers/on-device-provider);
 * then `ready` or `downloading` (registered but not yet ready).
 */
export function useOnDeviceModelStatus(): OnDeviceModelState {
  const [state, setState] = useState<OnDeviceModelState>({ status: 'none' });
  useEffect(() => {
    let alive = true;
    const provider = listProviders().find((p) => p.kind === 'on-device');
    if (!provider) return;
    Promise.resolve(provider.isAvailable())
      .then((ready) => {
        if (alive) setState({ status: ready ? 'ready' : 'downloading', modelId: provider.label });
      })
      .catch((err: unknown) => {
        if (alive) setState({ status: 'error', modelId: provider.label, errorMessage: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/**
 * usePreSessionCoach
 *
 * React hook around `coach-warmup-provider.buildWarmupForSession`.
 * Callers invoke `generateWarmup(template)` from a button press and
 * observe `warmup`, `loading`, `error` state.
 *
 * Flag-gated by `EXPO_PUBLIC_WARMUP_COACH` (through the underlying
 * provider). When the flag is off, `enabled` is false and
 * `generateWarmup` resolves to `null` immediately — no Gemma request,
 * no state churn.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildWarmupForSession,
  isWarmupCoachFlowEnabled,
  type BuildWarmupOptions,
  type SessionTemplateLike,
  type WarmupPlan,
} from '@/lib/services/coach-warmup-provider';

export interface UsePreSessionCoachOptions {
  /** Test-only: override the provider so tests don't mock the full chain. */
  providerOverride?: (
    template: SessionTemplateLike,
    options?: BuildWarmupOptions,
  ) => Promise<WarmupPlan | null>;
  /** Test-only: pretend the flag is on. */
  bypassFlag?: boolean;
}

export interface UsePreSessionCoachResult {
  warmup: WarmupPlan | null;
  loading: boolean;
  error: Error | null;
  /**
   * Triggers a warmup build. Resolves to the built `WarmupPlan` (or
   * `null` when the flag is off / template is empty / provider threw —
   * in the error case the hook's `error` state also gets set).
   */
  generateWarmup: (template: SessionTemplateLike) => Promise<WarmupPlan | null>;
  /** Clear any stored plan / error without re-running. */
  reset: () => void;
  /** True when the master flag is on. */
  enabled: boolean;
}

export function usePreSessionCoach(
  options: UsePreSessionCoachOptions = {},
): UsePreSessionCoachResult {
  const { providerOverride, bypassFlag } = options;

  const [warmup, setWarmup] = useState<WarmupPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const enabled = bypassFlag === true ? true : isWarmupCoachFlowEnabled();

  const generateWarmup = useCallback(
    async (template: SessionTemplateLike): Promise<WarmupPlan | null> => {
      if (!enabled) {
        setWarmup(null);
        setError(null);
        setLoading(false);
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const impl = providerOverride ?? buildWarmupForSession;
        const plan = await impl(template, { bypassFlag: bypassFlag === true });
        if (!mountedRef.current) return plan;
        setWarmup(plan);
        setLoading(false);
        return plan;
      } catch (err) {
        const wrapped =
          err instanceof Error ? err : new Error('Warmup generation failed');
        if (mountedRef.current) {
          setError(wrapped);
          setLoading(false);
        }
        return null;
      }
    },
    [enabled, providerOverride, bypassFlag],
  );

  const reset = useCallback(() => {
    setWarmup(null);
    setError(null);
    setLoading(false);
  }, []);

  return { warmup, loading, error, generateWarmup, reset, enabled };
}

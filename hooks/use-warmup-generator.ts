/**
 * useWarmupGenerator
 *
 * React hook wrapping `generateWarmup` with loading / result / error / reset.
 */
import { useCallback, useRef, useState } from 'react';
import {
  generateWarmup,
  type WarmupPlan,
  type WarmupGeneratorRuntime,
} from '@/lib/services/warmup-generator';
import type { WarmupGeneratorInput } from '@/lib/services/warmup-generator-prompt';
import type { AppError } from '@/lib/services/ErrorHandler';

export interface WarmupGeneratorHook {
  readonly loading: boolean;
  readonly result: WarmupPlan | null;
  readonly error: AppError | Error | null;
  generate: (input: WarmupGeneratorInput) => Promise<WarmupPlan | null>;
  reset: () => void;
}

export interface UseWarmupGeneratorOptions {
  runtime?: WarmupGeneratorRuntime;
  onSuccess?: (plan: WarmupPlan) => void;
  onError?: (err: AppError | Error) => void;
}

export function useWarmupGenerator(options: UseWarmupGeneratorOptions = {}): WarmupGeneratorHook {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WarmupPlan | null>(null);
  const [error, setError] = useState<AppError | Error | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const generate = useCallback(async (input: WarmupGeneratorInput): Promise<WarmupPlan | null> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const plan = await generateWarmup(input, optionsRef.current.runtime ?? {});
      setResult(plan);
      optionsRef.current.onSuccess?.(plan);
      return plan;
    } catch (err) {
      const e = err as AppError | Error;
      setError(e);
      optionsRef.current.onError?.(e);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setResult(null);
    setError(null);
  }, []);

  return { loading, result, error, generate, reset };
}

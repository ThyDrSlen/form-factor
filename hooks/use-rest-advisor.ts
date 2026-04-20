/**
 * useRestAdvisor
 *
 * React hook wrapping suggestRestSeconds with loading / result / error / reset.
 */
import { useCallback, useRef, useState } from 'react';
import {
  suggestRestSeconds,
  type RestAdvice,
  type RestAdvisorInput,
  type RestAdvisorRuntime,
} from '@/lib/services/rest-advisor';
import type { AppError } from '@/lib/services/ErrorHandler';

export interface RestAdvisorHook {
  readonly loading: boolean;
  readonly result: RestAdvice | null;
  readonly error: AppError | Error | null;
  suggest: (input: RestAdvisorInput) => Promise<RestAdvice | null>;
  reset: () => void;
}

export interface UseRestAdvisorOptions {
  runtime?: RestAdvisorRuntime;
  onSuccess?: (advice: RestAdvice) => void;
  onError?: (err: AppError | Error) => void;
}

export function useRestAdvisor(options: UseRestAdvisorOptions = {}): RestAdvisorHook {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RestAdvice | null>(null);
  const [error, setError] = useState<AppError | Error | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const suggest = useCallback(async (input: RestAdvisorInput): Promise<RestAdvice | null> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const advice = await suggestRestSeconds(input, optionsRef.current.runtime ?? {});
      setResult(advice);
      optionsRef.current.onSuccess?.(advice);
      return advice;
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

  return { loading, result, error, suggest, reset };
}

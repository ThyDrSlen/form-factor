/**
 * useSessionGenerator
 *
 * React hook that wraps `generateSession` with loading / result / error state
 * and a reset action. Dispatcher is memoized so callers can safely declare the
 * hook at render time without retriggering.
 */
import { useCallback, useRef, useState } from 'react';
import {
  generateSession,
  type HydratedTemplate,
  type SessionGeneratorRuntime,
} from '@/lib/services/session-generator';
import type { SessionGeneratorInput } from '@/lib/services/session-generator-prompt';
import type { AppError } from '@/lib/services/ErrorHandler';

export interface SessionGeneratorHook {
  readonly loading: boolean;
  readonly result: HydratedTemplate | null;
  readonly error: AppError | Error | null;
  generate: (input: SessionGeneratorInput) => Promise<HydratedTemplate | null>;
  reset: () => void;
}

export interface UseSessionGeneratorOptions {
  runtime: SessionGeneratorRuntime;
  /** Optional callback fired on success. */
  onSuccess?: (hydrated: HydratedTemplate) => void;
  /** Optional callback fired on error. */
  onError?: (err: AppError | Error) => void;
}

export function useSessionGenerator(options: UseSessionGeneratorOptions): SessionGeneratorHook {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HydratedTemplate | null>(null);
  const [error, setError] = useState<AppError | Error | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const generate = useCallback(async (input: SessionGeneratorInput): Promise<HydratedTemplate | null> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const opts = optionsRef.current;
      const hydrated = await generateSession(input, opts.runtime);
      setResult(hydrated);
      opts.onSuccess?.(hydrated);
      return hydrated;
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

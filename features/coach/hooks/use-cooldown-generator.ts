/**
 * useCooldownGenerator
 */
import { useCallback, useRef, useState } from 'react';
import {
  generateCooldown,
  type CooldownPlan,
  type CooldownGeneratorRuntime,
} from '@/lib/services/cooldown-generator';
import type { CooldownGeneratorInput } from '@/lib/services/cooldown-generator-prompt';
import type { AppError } from '@/lib/services/ErrorHandler';

export interface CooldownGeneratorHook {
  readonly loading: boolean;
  readonly result: CooldownPlan | null;
  readonly error: AppError | Error | null;
  generate: (input: CooldownGeneratorInput) => Promise<CooldownPlan | null>;
  reset: () => void;
}

export interface UseCooldownGeneratorOptions {
  runtime?: CooldownGeneratorRuntime;
  onSuccess?: (plan: CooldownPlan) => void;
  onError?: (err: AppError | Error) => void;
}

export function useCooldownGenerator(options: UseCooldownGeneratorOptions = {}): CooldownGeneratorHook {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CooldownPlan | null>(null);
  const [error, setError] = useState<AppError | Error | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const generate = useCallback(async (input: CooldownGeneratorInput): Promise<CooldownPlan | null> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const plan = await generateCooldown(input, optionsRef.current.runtime ?? {});
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

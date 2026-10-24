import { useMemo } from 'react';
import {
  getGlossaryEntriesByFaultId,
  getGlossaryEntry,
  type FaultGlossaryEntry,
} from '@/lib/services/fault-glossary-store';

/**
 * Look up a fault glossary entry. When both `exerciseId` and `faultId` are
 * provided, returns the (exercise, fault) pair. When only `faultId`, returns
 * the first entry across exercises (or `null` if none).
 *
 * Named `useFaultGlossary` — intentionally distinct from PR #478's
 * `use-fault-explanations` (plural) to prevent confusion.
 */
export function useFaultGlossary(
  exerciseId: string | null | undefined,
  faultId: string | null | undefined,
): FaultGlossaryEntry | null {
  return useMemo(() => {
    if (!faultId) return null;
    if (exerciseId) {
      const specific = getGlossaryEntry(exerciseId, faultId);
      if (specific) return specific;
    }
    const fallback = getGlossaryEntriesByFaultId(faultId);
    return fallback[0] ?? null;
  }, [exerciseId, faultId]);
}

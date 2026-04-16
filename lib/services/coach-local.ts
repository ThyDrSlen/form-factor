/**
 * On-device coach provider — SCAFFOLD ONLY.
 *
 * Mirrors the `sendCoachPrompt` interface from `coach-service.ts` so the
 * dispatcher can swap providers behind `EXPO_PUBLIC_COACH_LOCAL=1` and
 * the cohort gate. Actual model runtime (react-native-executorch + .pte
 * weights) is deferred to PR-D; see `docs/gemma-integration.md` §5.
 *
 * Today this function throws `COACH_LOCAL_NOT_AVAILABLE`; the dispatcher
 * in coach-service catches this sentinel and falls back to cloud.
 *
 * Step 9 will pipe safety + context enrichment hooks through this file so
 * that swapping the throw for a real `runtime.generate()` call is a
 * one-line change.
 */

import { createError } from './ErrorHandler';
import type { CoachMessage, CoachContext } from './coach-service';

export const COACH_LOCAL_NOT_AVAILABLE = 'COACH_LOCAL_NOT_AVAILABLE';

export async function sendCoachPromptLocal(
  _messages: CoachMessage[],
  _context?: CoachContext
): Promise<CoachMessage> {
  throw createError(
    'ml',
    COACH_LOCAL_NOT_AVAILABLE,
    'On-device coach runtime is not available yet.',
    {
      retryable: false,
      severity: 'info',
      details: {
        note: 'Falls back to cloud; runtime lands in PR-D (react-native-executorch).',
      },
    }
  );
}

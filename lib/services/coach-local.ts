/**
 * On-device coach provider stub.
 *
 * Mirrors the public interface of `lib/services/coach-service.ts` so the
 * dispatcher in `sendCoachPrompt` can try this path first when the
 * `EXPO_PUBLIC_COACH_LOCAL` flag is on and fall back to cloud cleanly.
 *
 * Real implementation will use `react-native-executorch` to load a
 * quantized Gemma 3 270M (INT4 QAT) `.pte` bundle and call `useLLM().generate()`.
 * See `docs/gemma-integration.md` for the stack, numbers, and rollout plan.
 *
 * For now every call throws a typed `COACH_LOCAL_NOT_AVAILABLE` error that
 * the dispatcher recognizes as a signal to fall back to the cloud path. The
 * error shape is stable and covered by unit tests — do not change it without
 * also updating `coach-service.ts` and `tests/unit/services/coach-local.test.ts`.
 */

import { createError } from './ErrorHandler';
import type { CoachContext, CoachMessage } from './coach-service';

/**
 * Stable error code the dispatcher looks for to trigger the cloud fallback.
 * Keep in sync with the match in `coach-service.ts` and the test assertions.
 */
export const COACH_LOCAL_NOT_AVAILABLE = 'COACH_LOCAL_NOT_AVAILABLE';

/**
 * On-device variant of `sendCoachPrompt`. Same signature so the dispatcher
 * can swap providers without changing its call sites.
 *
 * @throws AppError with `code === 'COACH_LOCAL_NOT_AVAILABLE'` while the
 *         ExecuTorch runtime and Gemma weights are not wired up. The
 *         dispatcher in `coach-service.ts` catches this and retries on cloud.
 */
export async function sendCoachPromptLocal(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _messages: CoachMessage[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context?: CoachContext
): Promise<CoachMessage> {
  // TODO(#415-followup): load the Gemma 3 270M INT4 `.pte` bundle via
  // `react-native-executorch` `useLLM`. Guard on Platform.OS === 'ios' and
  // device capability (A16+). See docs/gemma-integration.md §8 (Next steps).

  // TODO(#415-followup): fetch weights via Expo Background Assets on first
  // launch, Wi-Fi-only, user opt-in. Surface the download progress to the UI.

  // TODO(#415-followup): map `CoachMessage[]` into the Gemma chat template
  // (system / user / model turns). Respect `context.focus` as a system-prompt
  // prefix for per-exercise framing.

  // TODO(#415-followup): call `llm.generate(prompt, { maxTokens: 256 })`
  // and return `{ role: 'assistant', content: trimmed }`. Propagate thermal
  // throttling and OOM as retryable errors so the cloud path can pick up.

  throw createError(
    'ml',
    COACH_LOCAL_NOT_AVAILABLE,
    'On-device coach is not available yet. Falling back to cloud.',
    {
      retryable: false,
      severity: 'info',
    }
  );
}

/**
 * Whether the on-device provider is ready to serve a prompt right now.
 *
 * Currently always `false` — the stub exists so the dispatcher and tests can
 * compile against a stable surface area. Real implementation will check
 * runtime availability + weights on disk + thermal/battery state.
 */
export async function isCoachLocalAvailable(): Promise<boolean> {
  // TODO(#415-followup): return `true` when the ExecuTorch runtime has loaded
  // the Gemma `.pte`, the device is not thermally throttled, and the battery
  // is not in low-power mode.
  return false;
}

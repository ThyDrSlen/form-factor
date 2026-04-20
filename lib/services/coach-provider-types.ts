/**
 * Coach provider discriminator — which AI backend produced a given reply.
 *
 * Surfaced in the coach chat UI so users can see which model answered each
 * message (OpenAI GPT, Google Gemma, local fallback, or a cache hit).
 */
export type CoachProvider =
  | 'openai'
  | 'gemma-cloud'
  | 'gemma-on-device'
  | 'local-fallback'
  | 'cached';

/**
 * Coarse signal the edge function / service layer may emit to describe which
 * source produced a reply. The service normalises this into `CoachProvider`.
 */
export interface CoachProviderSignal {
  /** Explicit provider, if the edge function returns one. */
  provider?: CoachProvider | string;
  /** Model identifier string, e.g. `gpt-5.4-mini`, `gemma-2b`. */
  model?: string;
  /** Marks the reply as coming from an on-device cache or local fallback path. */
  source?: 'cache' | 'local' | 'remote';
}

const KNOWN_PROVIDERS: readonly CoachProvider[] = [
  'openai',
  'gemma-cloud',
  'gemma-on-device',
  'local-fallback',
  'cached',
] as const;

let hasWarnedAboutAmbiguousProvider = false;

/**
 * Derive a `CoachProvider` from an opaque signal returned by the coach edge
 * function. Preference order:
 *   1. Explicit `provider` field (if it is one of the known values).
 *   2. `source === 'cache'` → `'cached'`.
 *   3. `source === 'local'` → `'local-fallback'`.
 *   4. Model-name prefix inference (`gpt-*` → openai, `gemma-*` → gemma-cloud).
 *
 * WHY inference: today the edge function stores only `{ model: 'gpt-5.4-mini' }`
 * in `coach_conversations.metadata`. Until it starts returning an explicit
 * provider, we infer from the model name so the UI can still show a badge.
 * If two signals conflict or a model is unrecognised, we default to `'openai'`
 * (current behaviour) and warn once in dev.
 */
export function inferCoachProvider(
  signal: CoachProviderSignal | null | undefined,
): CoachProvider {
  if (!signal) return 'openai';

  const explicit = signal.provider?.toString().trim();
  if (explicit && (KNOWN_PROVIDERS as readonly string[]).includes(explicit)) {
    return explicit as CoachProvider;
  }

  if (signal.source === 'cache') return 'cached';
  if (signal.source === 'local') return 'local-fallback';

  const model = signal.model?.toString().toLowerCase() ?? '';
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
    return 'openai';
  }
  if (model.startsWith('gemma-')) {
    // Absent a `source`, cloud Gemma is the common case today.
    return 'gemma-cloud';
  }
  if (model.includes('on-device') || model.includes('ondevice')) {
    return 'gemma-on-device';
  }

  if (__DEV__ && !hasWarnedAboutAmbiguousProvider) {
    hasWarnedAboutAmbiguousProvider = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[coach] Unable to infer coach provider from signal; defaulting to "openai".',
      { signal },
    );
  }
  return 'openai';
}

/**
 * Test-only hook for resetting the once-per-session warn flag.
 * Not exported from the package barrel — for Jest direct imports only.
 */
export function __resetCoachProviderInferenceWarning(): void {
  hasWarnedAboutAmbiguousProvider = false;
}

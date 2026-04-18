/**
 * Cactus (on-device Gemma 3n) FaultExplainer — Phase 1 stub.
 *
 * Phase 1 of the Gemma runtime rollout. See docs/GEMMA_RUNTIME_DECISION.md
 * for the full decision log: Phase 0 ships via an Edge Function
 * (`fault-explainer-edge.ts`); Phase 1 replaces it with an on-device model
 * loaded through the Cactus native bindings.
 *
 * STATUS: This is a stub. The Cactus native module (`react-native-cactus` or
 * equivalent) has not been installed yet — the native binding work is tracked
 * separately and is expected several weeks after this scaffold lands. Once
 * the module is available, the stub body of `synthesize` should be replaced
 * with:
 *
 *   1. GGUF model loading — `options.modelPath` points to the bundled Gemma
 *      3n GGUF file shipped as an EAS asset or downloaded on first launch.
 *   2. JNI / ObjC bridge calls — invoke the Cactus completion API with the
 *      prompt built from `FaultSynthesisInput` + glossary snippets.
 *   3. Tokenizer — encode the prompt, decode the response, and strip any
 *      leading/trailing whitespace or control tokens.
 *   4. Structured output — parse the JSON-mode response into
 *      `FaultSynthesisOutput` and return `source: 'gemma-local'`.
 *   5. Availability guard — `isCactusAvailable()` should call the native
 *      module's `isLoaded()` / `isAvailable()` API and cache the result.
 *
 * Until the native module lands, `isCactusAvailable()` returns `false` and
 * `synthesize` always throws `CactusNotInstalledError` so that callers
 * (and the UI error boundary) can detect the Phase 1 state cleanly rather
 * than receiving a cryptic "module not found" crash.
 */

import type { FaultExplainer, FaultSynthesisInput, FaultSynthesisOutput } from './fault-explainer';

// =============================================================================
// Public types
// =============================================================================

export interface CactusOptions {
  /**
   * Absolute path to the bundled GGUF model file. When omitted the real
   * implementation will fall back to a default EAS asset path.
   */
  modelPath?: string;
  /** Maximum number of tokens to generate in a single completion. */
  maxTokens?: number;
  /** Sampling temperature (0..1). Lower = more deterministic. */
  temperature?: number;
  /**
   * Minimum confidence required to return a local result; below this
   * threshold the runner should fall back to the static explainer.
   */
  confidenceThreshold?: number;
}

/**
 * Thrown when `synthesize` is called but the Cactus native bindings are not
 * yet installed. The UI should catch this, show a graceful degradation
 * message, and route the call to the static fallback or edge runner instead.
 */
export class CactusNotInstalledError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Cactus native bindings are not installed. See docs/GEMMA_RUNTIME_DECISION.md#phase-1.',
    );
    this.name = 'CactusNotInstalledError';
    // Restore prototype chain for `instanceof` checks in transpiled output.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// =============================================================================
// Availability probe
// =============================================================================

/**
 * Returns `true` when the Cactus native module is installed and a model is
 * ready to accept completions. Always `false` in the Phase 1 stub — will
 * delegate to the native module once it ships.
 */
export async function isCactusAvailable(): Promise<boolean> {
  // Phase 1 stub: native module not yet installed.
  return false;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Creates a `FaultExplainer` backed by on-device Gemma 3n via Cactus.
 *
 * The returned runner always throws `CactusNotInstalledError` in the Phase 1
 * stub. Accepted `options` are stored for when the real implementation
 * replaces this stub — they have no effect today.
 */
export function createCactusFaultExplainer(options?: CactusOptions): FaultExplainer {
  // `options` is intentionally unused in the stub but kept in the signature
  // so call sites do not need to change when the real implementation arrives.
  void options;

  return {
    async synthesize(_input: FaultSynthesisInput): Promise<FaultSynthesisOutput> {
      throw new CactusNotInstalledError();
    },
  };
}

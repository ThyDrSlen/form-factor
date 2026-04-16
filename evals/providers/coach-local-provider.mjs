/**
 * Promptfoo custom provider — Form Factor on-device coach (Gemma).
 *
 * Behaviour:
 *   - `COACH_LOCAL_EVAL=0` (default): proxies to the cloud provider so CI
 *     keeps working before the runtime is landed. Reports `id()` as
 *     `form-factor-coach-local:shim` so the parity report makes it clear
 *     we're running a shim, not real local inference.
 *   - `COACH_LOCAL_EVAL=1`: attempts to call the TypeScript
 *     `sendCoachPromptLocal` via a Node adapter. Until PR-D lands and the
 *     runtime is wired, this returns `COACH_LOCAL_NOT_AVAILABLE` — the
 *     parity script marks it as a known skip instead of failing the run.
 *
 * Zero new dependencies.
 */

import CloudCoachProvider from './coach-provider.mjs';

const LOCAL_EVAL_ENABLED = process.env.COACH_LOCAL_EVAL === '1';

export default class CoachLocalProvider {
  constructor(options = {}) {
    this.cloud = new CloudCoachProvider(options);
    this.modelOverride = options.config?.model || null;
  }

  id() {
    if (!LOCAL_EVAL_ENABLED) return 'form-factor-coach-local:shim';
    return 'form-factor-coach-local:gemma-3-270m-it-int4';
  }

  async callApi(prompt, context) {
    if (!LOCAL_EVAL_ENABLED) {
      // Shim: delegate to cloud. Note in the output so the parity report
      // knows this is not real local inference.
      const result = await this.cloud.callApi(prompt, context);
      if (result.output) {
        return {
          ...result,
          metadata: {
            ...(result.metadata || {}),
            provider_kind: 'shim-cloud',
          },
        };
      }
      return result;
    }

    // Real local path — requires node adapter bridging into the RN module.
    // Until PR-D lands this always returns "not available".
    return {
      error: 'COACH_LOCAL_NOT_AVAILABLE',
      metadata: {
        provider_kind: 'local-stub',
        note: 'Runtime lands in PR-D (react-native-executorch). Adapter wiring pending.',
      },
    };
  }
}

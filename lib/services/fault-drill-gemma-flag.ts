/**
 * fault-drill-gemma-flag
 *
 * Feature flag gate for the fault-heatmap "Ask Gemma for drills" CTA
 * and the underlying persistent-fault → drill-explainer pipeline.
 *
 * Parsing (strict):
 *   - `EXPO_PUBLIC_FAULT_DRILL_GEMMA=1`    → enabled
 *   - `EXPO_PUBLIC_FAULT_DRILL_GEMMA=true` → enabled
 *   - unset / anything else                → disabled (fail-closed)
 *
 * Intentionally strict: only literal `'1'` or `'true'` flip on. No
 * `'yes'` / `'on'` / `'TRUE'` / whitespace-padded variants. Keeps the
 * production default unambiguous — no CTA surfaces unless an operator
 * has explicitly opted in.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_FAULT_DRILL_GEMMA';

export function isFaultDrillGemmaEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === '1' || raw === 'true';
}

export const FAULT_DRILL_GEMMA_FLAG_ENV_VAR = FLAG_ENV_VAR;

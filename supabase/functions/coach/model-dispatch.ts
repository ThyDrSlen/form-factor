/**
 * Pure helpers for the coach edge-function model dispatch (#557 finding B2).
 *
 * The Deno handler in `./index.ts` can't be imported by Jest (Deno-only URL
 * imports), so the primary/fallback resolution primitives live here in a
 * framework-free module that Bun/Jest can exercise directly. The handler
 * imports nothing from this file — it duplicates the same three functions
 * so the Deno runtime stays self-contained — but the signatures are
 * intentionally identical so behavior drift between the two copies is
 * caught by this test suite plus code review.
 */
export interface ResolvedModel {
  model: string;
  path: 'primary' | 'fallback';
}

/**
 * Clamp + parse the COACH_MODEL_ROLLOUT_PCT env. Anything unparseable or
 * missing defaults to 100 so existing deploys don't accidentally downgrade
 * to fallback traffic just because the env wasn't set.
 */
export function parseRolloutPct(raw: string | undefined | null): number {
  if (raw == null || raw === '') return 100;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.floor(n);
}

/**
 * Stable 0-99 bucket for a user id. FNV-1a 32-bit — deterministic across
 * workers, no crypto dep, good enough distribution for cohort assignment.
 */
export function hashUserToBucket(userId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

/**
 * Pick primary or fallback for a given user based on the rollout percentage.
 * rollout=100 → everyone primary; rollout=0 → everyone fallback; in between →
 * deterministic cohort keyed on userId so the same user gets the same path
 * on every request (essential for cache hits + support-repro).
 */
export function resolveModelForUser(
  userId: string,
  opts: {
    primaryModel: string;
    fallbackModel: string;
    rolloutPct: number;
  },
): ResolvedModel {
  if (opts.rolloutPct >= 100) {
    return { model: opts.primaryModel, path: 'primary' };
  }
  if (opts.rolloutPct <= 0) {
    return { model: opts.fallbackModel, path: 'fallback' };
  }
  const bucket = hashUserToBucket(userId);
  return bucket < opts.rolloutPct
    ? { model: opts.primaryModel, path: 'primary' }
    : { model: opts.fallbackModel, path: 'fallback' };
}

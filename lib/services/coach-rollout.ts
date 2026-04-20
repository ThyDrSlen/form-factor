/**
 * Hashed cohort gate for the on-device coach rollout.
 *
 * Each user is deterministically bucketed 0-99 by hashing their
 * `profile.id`. The on-device path runs ONLY when the user's bucket is
 * below the configured percentage (`EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT`,
 * default `0`).
 *
 * Why FNV-1a? Standard library, zero dependencies, good-enough
 * distribution for cohort bucketing (not a security-sensitive use case).
 */

const DEFAULT_COHORT_ENV = 'EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT';

/**
 * FNV-1a 32-bit hash. Small and dependency-free. Output is an unsigned
 * 32-bit integer.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5; // offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime: 0x01000193
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Map a stable user id to a bucket in [0, 99].
 */
export function bucketFor(userId: string | null | undefined): number {
  if (!userId) return -1;
  return fnv1a(userId) % 100;
}

/**
 * Read the cohort percentage from env (or caller override).
 * Clamps to [0, 100]. Non-numeric values yield 0.
 */
export function readCohortPct(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return Math.max(0, Math.min(100, Math.floor(override)));
  }
  const raw = process.env[DEFAULT_COHORT_ENV];
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

/**
 * Is this user in the on-device cohort?
 *
 * - Returns `false` for missing userId (can't gate on anything stable).
 * - Returns `false` when cohort pct is 0.
 * - Returns `true` when the user's bucket < cohort pct.
 */
export function isInCohort(
  userId: string | null | undefined,
  pctOverride?: number
): boolean {
  const pct = readCohortPct(pctOverride);
  if (pct <= 0) return false;
  if (!userId) return false;
  const bucket = bucketFor(userId);
  return bucket < pct;
}

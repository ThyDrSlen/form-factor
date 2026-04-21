/**
 * coach-warmup-provider
 *
 * Thin wrapper around `warmup-generator.generateWarmup` that layers:
 *   - flag-gating via `EXPO_PUBLIC_WARMUP_COACH` (fail-closed)
 *   - session-template → `WarmupGeneratorInput` normalization
 *   - consistent `WarmupPlan` re-export
 *
 * The underlying generator lives in `lib/services/warmup-generator.ts`
 * and is imported read-only. All Gemma / coach transport concerns
 * (JSON schema, retries, coach context) are delegated to it.
 *
 * When the master flag is off, `buildWarmupForSession` returns `null`
 * immediately without touching the generator — no Gemma request fires,
 * no tokens burned, no side effects.
 */

import {
  generateWarmup as generateWarmupImpl,
  type WarmupGeneratorRuntime,
  type WarmupPlan as GeneratorWarmupPlan,
} from '@/lib/services/warmup-generator';
import type { WarmupGeneratorInput } from '@/lib/services/warmup-generator-prompt';
import { isWarmupCoachEnabled } from '@/lib/services/warmup-coach-flag';

// Re-export the generator's WarmupPlan shape so callers only import
// from this provider. If the generator surface ever changes, this file
// is the single adaption point.
export type WarmupPlan = GeneratorWarmupPlan;
export type { WarmupMovement } from '@/lib/services/warmup-generator';

export interface SessionTemplateLike {
  /**
   * Slugs (or human-readable names — we lower/slugify internally) of
   * the main-session exercises this warmup precedes.
   */
  exerciseSlugs?: readonly string[];
  /** Alternate: flat list of exercises with a `name` / `slug` property. */
  exercises?: ReadonlyArray<{ slug?: string; name?: string }>;
  /** Target warmup duration in minutes. */
  durationMin?: number;
  /** User-supplied free-text hint (e.g. "left shoulder stiff today"). */
  userContext?: string;
}

export interface BuildWarmupOptions {
  runtime?: WarmupGeneratorRuntime;
  /**
   * Test-only injection seam. Production callers should never pass this —
   * the generator import is the one source of truth.
   */
  generatorOverride?: (
    input: WarmupGeneratorInput,
    runtime?: WarmupGeneratorRuntime,
  ) => Promise<WarmupPlan>;
  /** Bypass the flag for tests. Production code must not use this. */
  bypassFlag?: boolean;
}

function slugify(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function normalizeExerciseSlugs(template: SessionTemplateLike): string[] {
  if (Array.isArray(template.exerciseSlugs) && template.exerciseSlugs.length > 0) {
    return template.exerciseSlugs
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map(slugify);
  }
  if (Array.isArray(template.exercises) && template.exercises.length > 0) {
    return template.exercises
      .map((e) => (typeof e.slug === 'string' ? e.slug : typeof e.name === 'string' ? e.name : ''))
      .filter((s) => s.length > 0)
      .map(slugify);
  }
  return [];
}

export function buildGeneratorInput(template: SessionTemplateLike): WarmupGeneratorInput {
  const exerciseSlugs = normalizeExerciseSlugs(template);
  return {
    exerciseSlugs,
    durationMin: typeof template.durationMin === 'number' ? template.durationMin : undefined,
    userContext:
      typeof template.userContext === 'string' && template.userContext.trim().length > 0
        ? template.userContext
        : undefined,
  };
}

/**
 * Build a warmup plan for the supplied session template.
 *
 * Returns:
 *   - `null` when `EXPO_PUBLIC_WARMUP_COACH` is off (fail-closed).
 *   - `null` when the template contains no resolvable exercises — the
 *     generator rejects empty inputs anyway; we bail early to avoid
 *     burning a coach request.
 *   - A validated `WarmupPlan` on success.
 *
 * Errors from the generator (network, schema validation, retry
 * exhaustion) propagate — callers layer their own UI fallback.
 */
export async function buildWarmupForSession(
  template: SessionTemplateLike,
  options: BuildWarmupOptions = {},
): Promise<WarmupPlan | null> {
  const enabled = options.bypassFlag === true ? true : isWarmupCoachEnabled();
  if (!enabled) return null;

  const input = buildGeneratorInput(template);
  if (input.exerciseSlugs.length === 0) return null;

  const generator = options.generatorOverride ?? generateWarmupImpl;
  return generator(input, options.runtime);
}

/**
 * Exposes whether the warmup coach flow is currently live. Useful for
 * CTA visibility checks that don't need to call the generator.
 */
export function isWarmupCoachFlowEnabled(): boolean {
  return isWarmupCoachEnabled();
}

/**
 * Stateful cue-text rotator.
 *
 * Any live session that speaks the same cue over and over hits the
 * "brace your core x5" retention tax. This rotator maps a base cue
 * string to an authored set of equivalent phrasings and cycles through
 * them in order. Unknown base strings fall through unchanged.
 *
 * Intentionally dumb: no LLM, no semantic matching — an exact-string
 * lookup. Authors add variants to `cue-rotator-variants.ts` as they
 * identify high-frequency cues. This is the "no Gemma needed" retention
 * win flagged in docs/GEMMA_INTEGRATION_POINTS.md.
 */

export type CueVariantMap = Record<string, string[]>;

export interface CueRotator {
  /** Returns a varied version of `baseCue`, or the base string unchanged. */
  rotate(baseCue: string): string;
  /** Resets all rotation indices. Useful at the start of a new session. */
  reset(): void;
}

export function createCueRotator(map: CueVariantMap): CueRotator {
  const indices = new Map<string, number>();

  return {
    rotate(baseCue: string): string {
      const variants = map[baseCue];
      if (!variants || variants.length === 0) return baseCue;
      const idx = indices.get(baseCue) ?? 0;
      const picked = variants[idx % variants.length] ?? baseCue;
      indices.set(baseCue, (idx + 1) % variants.length);
      return picked;
    },
    reset(): void {
      indices.clear();
    },
  };
}

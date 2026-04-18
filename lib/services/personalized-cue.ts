/**
 * Personalized coaching cue service — generates a single user-facing cue
 * for a detected fault, optionally enriched with the user's own history.
 *
 * Mirrors the fault-explainer pluggable-runner pattern: a deterministic
 * static runner ships today; a Gemma-backed runner can be swapped in at
 * runtime once available. Callers talk only to the `PersonalizedCueRunner`
 * interface and never care which backend is active.
 *
 * The "third-session" case is the primary behavioral hook: if a user has
 * seen this fault three or more times and it fired again in the last session,
 * the cue explicitly calls out the recurrence so it feels personal.
 */

import { getGlossaryEntry } from '@/lib/services/fault-glossary-store';

// =============================================================================
// Types
// =============================================================================

export interface UserFaultHistoryItem {
  faultId: string;
  /** How many sessions ago this fault was last seen (0 = current session). */
  lastSeenSessionsAgo: number;
  /** Total number of times this fault has appeared across all sessions. */
  totalOccurrences: number;
}

export interface CueInput {
  faultId: string;
  exerciseId: string;
  userHistory?: UserFaultHistoryItem[];
}

export interface CueOutput {
  /** The user-facing coaching cue string. */
  cue: string;
  /** True when the cue explicitly references the user's past history. */
  referencesHistory: boolean;
  source: 'static' | 'gemma-local' | 'gemma-cloud';
}

export interface PersonalizedCueRunner {
  getCue(input: CueInput): Promise<CueOutput>;
}

// =============================================================================
// Static runner
// =============================================================================

const FALLBACK_CUE = 'Nothing more to add.';
const THIRD_SESSION_PREFIX = 'Third session in a row on this one — ';

export const staticPersonalizedCueRunner: PersonalizedCueRunner = {
  async getCue(input: CueInput): Promise<CueOutput> {
    const entry = getGlossaryEntry(input.exerciseId, input.faultId);

    if (!entry) {
      return {
        cue: FALLBACK_CUE,
        referencesHistory: false,
        source: 'static',
      };
    }

    const historyEntry = input.userHistory?.find(
      (h) => h.faultId === input.faultId,
    );

    // "Third session in a row" path: recurrent fault seen recently
    if (
      historyEntry &&
      historyEntry.totalOccurrences >= 3 &&
      historyEntry.lastSeenSessionsAgo <= 1
    ) {
      return {
        cue: `${THIRD_SESSION_PREFIX}${entry.shortExplanation}`,
        referencesHistory: true,
        source: 'static',
      };
    }

    // First-timer path: no history or zero occurrences → show baseline explanation
    if (!historyEntry || historyEntry.totalOccurrences === 0) {
      return {
        cue: entry.shortExplanation,
        referencesHistory: false,
        source: 'static',
      };
    }

    // Returning user (1–2 occurrences, or stale recurrence): serve the fix tip
    return {
      cue: entry.fixTips[0] ?? entry.shortExplanation,
      referencesHistory: false,
      source: 'static',
    };
  },
};

// =============================================================================
// Pluggable singleton — swap in a real runner at app init
// =============================================================================

let activeRunner: PersonalizedCueRunner = staticPersonalizedCueRunner;

export function getPersonalizedCueRunner(): PersonalizedCueRunner {
  return activeRunner;
}

/**
 * Install a real runner (e.g. Gemma via Cactus) once it has loaded. Pass
 * `null` to revert to the static runner. Safe to call multiple times — last
 * write wins.
 */
export function setPersonalizedCueRunner(
  runner: PersonalizedCueRunner | null,
): void {
  activeRunner = runner ?? staticPersonalizedCueRunner;
}

/** Reset hook for tests only — not for production use. */
export function __resetPersonalizedCueForTests(): void {
  activeRunner = staticPersonalizedCueRunner;
}

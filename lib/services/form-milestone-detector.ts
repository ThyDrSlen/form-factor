/**
 * Form Milestone Detector
 *
 * Post-session pure function that looks for two kinds of win worth
 * surfacing to the user inline:
 *
 *   - `new_pb`: this session's average FQI beats the athlete's prior
 *     best on the same exercise by at least PB_MARGIN points.
 *   - `week_consistency`: the last `WEEK_WINDOW_SESSIONS` sessions
 *     (including this one) are all within a tight FQI band, signalling
 *     a repeatable groove worth celebrating.
 *
 * The function is pure so it is cheap to test and easy to hook into any
 * post-session pipeline — the caller decides how to surface the result
 * (toast, badge, notification, etc.).
 */

export type MilestoneKind = 'new_pb' | 'week_consistency';

export interface PriorSession {
  /** Average FQI for a completed session on this exercise. */
  avgFqi: number;
  /** ISO timestamp the session ended (or started — we only use recency). */
  endedAt?: string;
}

export interface DetectMilestoneInput {
  exerciseKey: string;
  currentAvgFqi: number;
  /** Prior sessions on the same exercise, newest-first or any order. */
  priorSessions: PriorSession[];
  /** Required PB margin in raw FQI points (default 2). */
  pbMargin?: number;
  /** Required minimum current FQI to qualify for a PB (default 0). */
  pbMinScore?: number;
  /** Band-width for week-consistency (default 5 FQI points). */
  consistencyBand?: number;
  /** Window of sessions considered for consistency (default 3). */
  consistencyWindow?: number;
  /** Floor for the consistency signal to fire (default 70). */
  consistencyMinScore?: number;
}

export interface MilestoneResult {
  kind: MilestoneKind | null;
  message: string;
  score: number;
}

const DEFAULTS = {
  pbMargin: 2,
  pbMinScore: 0,
  consistencyBand: 5,
  consistencyWindow: 3,
  consistencyMinScore: 70,
} as const;

function formatScore(score: number): string {
  return Math.round(score).toString();
}

function exerciseLabel(exerciseKey: string): string {
  if (!exerciseKey) return 'this exercise';
  return exerciseKey.replace(/[_-]+/g, ' ').trim() || 'this exercise';
}

/**
 * Analyse a finished session. Returns `{ kind: null }` when no milestone
 * fires — the caller can use `if (result.kind)` as a cheap gate.
 */
export function detectMilestone(input: DetectMilestoneInput): MilestoneResult {
  const {
    exerciseKey,
    currentAvgFqi,
    priorSessions,
    pbMargin = DEFAULTS.pbMargin,
    pbMinScore = DEFAULTS.pbMinScore,
    consistencyBand = DEFAULTS.consistencyBand,
    consistencyWindow = DEFAULTS.consistencyWindow,
    consistencyMinScore = DEFAULTS.consistencyMinScore,
  } = input;

  const score = safeNumber(currentAvgFqi);
  if (score == null) {
    return { kind: null, message: '', score: 0 };
  }

  const priors = (priorSessions ?? [])
    .map((p) => safeNumber(p.avgFqi))
    .filter((v): v is number => v != null);

  // ---- PB check ----
  // First session ever: only a PB if we clear the explicit pbMinScore.
  // Subsequent sessions: must beat max(prior) by at least pbMargin.
  if (priors.length === 0) {
    if (score >= pbMinScore && pbMinScore > 0) {
      return {
        kind: 'new_pb',
        message: buildPbMessage(score, exerciseKey),
        score,
      };
    }
  } else {
    const priorBest = Math.max(...priors);
    if (score - priorBest >= pbMargin && score >= pbMinScore) {
      return {
        kind: 'new_pb',
        message: buildPbMessage(score, exerciseKey),
        score,
      };
    }
  }

  // ---- Week-consistency check ----
  // Needs (consistencyWindow - 1) priors plus the current session in a
  // tight band, each at or above consistencyMinScore. We compare on the
  // priors provided by the caller; the caller is responsible for
  // bounding to the last 7 days if they want strict "week" semantics.
  const windowScores = [score, ...priors].slice(0, consistencyWindow);
  if (windowScores.length >= consistencyWindow) {
    const min = Math.min(...windowScores);
    const max = Math.max(...windowScores);
    if (min >= consistencyMinScore && max - min <= consistencyBand) {
      return {
        kind: 'week_consistency',
        message: buildConsistencyMessage(score, exerciseKey, consistencyWindow),
        score,
      };
    }
  }

  return { kind: null, message: '', score };
}

function safeNumber(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw !== 'number') return null;
  if (!Number.isFinite(raw)) return null;
  return raw;
}

function buildPbMessage(score: number, exerciseKey: string): string {
  return `New record: ${formatScore(score)}/100 form on ${exerciseLabel(exerciseKey)}`;
}

function buildConsistencyMessage(
  score: number,
  exerciseKey: string,
  window: number,
): string {
  return `Dialed in: ${window} straight ${exerciseLabel(exerciseKey)} sessions around ${formatScore(score)}/100`;
}

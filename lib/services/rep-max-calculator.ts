/**
 * Rep-max / 1-RM estimation helpers.
 *
 * Implements three industry-standard estimators so downstream suggestion
 * logic can average or compare them:
 *   - Epley    : 1RM = weight * (1 + reps / 30)
 *   - Brzycki  : 1RM = weight * 36 / (37 - reps)   [reps < 37]
 *   - Lombardi : 1RM = weight * reps ^ 0.10
 *
 * All formulas degenerate cleanly at reps = 1 (1RM = weight). Brzycki's
 * denominator blows up near reps = 37, so we clamp before computing.
 *
 * Confidence scoring favours lower rep counts (3-6 is sweet spot); very
 * high-rep sets drift further from the true 1RM and the estimators diverge.
 */

export type RepMaxFormula = 'epley' | 'brzycki' | 'lombardi';

export interface RepMaxInput {
  /** Weight lifted in the set (any consistent unit). */
  weight: number;
  /** Reps completed at that weight. Must be a positive integer. */
  reps: number;
}

export interface RepMaxEstimate {
  /** Estimated one-rep max in the same unit as the input weight. */
  oneRepMax: number;
  /** Which formula produced the estimate. */
  formula: RepMaxFormula;
  /** 0..1 confidence that the estimate reflects a true maximal effort. */
  confidence: number;
}

export interface MultiFormulaEstimate {
  /** Average 1RM across the three formulas. */
  oneRepMax: number;
  /** Estimate per formula (useful for charts + debugging). */
  perFormula: Record<RepMaxFormula, number>;
  /** 0..1 confidence. */
  confidence: number;
}

const MAX_BRZYCKI_REPS = 36;

function isValidInput({ weight, reps }: RepMaxInput): boolean {
  return (
    Number.isFinite(weight) &&
    weight > 0 &&
    Number.isInteger(reps) &&
    reps > 0
  );
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function epleyOneRepMax(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return round(weight * (1 + reps / 30));
}

export function brzyckiOneRepMax(weight: number, reps: number): number {
  if (reps === 1) return weight;
  const clamped = Math.min(reps, MAX_BRZYCKI_REPS);
  return round(weight * (36 / (37 - clamped)));
}

export function lombardiOneRepMax(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return round(weight * Math.pow(reps, 0.1));
}

/**
 * Confidence band based on rep count. Single-rep lifts are treated as
 * ground truth (1.0); bands taper as reps grow because the relationship
 * between sub-maximal reps and 1RM becomes noisier.
 */
export function repsToConfidence(reps: number): number {
  if (!Number.isInteger(reps) || reps <= 0) return 0;
  if (reps === 1) return 1;
  if (reps <= 3) return 0.95;
  if (reps <= 6) return 0.88;
  if (reps <= 10) return 0.78;
  if (reps <= 15) return 0.6;
  if (reps <= 20) return 0.45;
  return 0.3;
}

export function estimateOneRepMax(
  input: RepMaxInput,
  formula: RepMaxFormula = 'epley',
): RepMaxEstimate {
  if (!isValidInput(input)) {
    return { oneRepMax: 0, formula, confidence: 0 };
  }

  const { weight, reps } = input;
  let oneRepMax: number;
  switch (formula) {
    case 'brzycki':
      oneRepMax = brzyckiOneRepMax(weight, reps);
      break;
    case 'lombardi':
      oneRepMax = lombardiOneRepMax(weight, reps);
      break;
    case 'epley':
    default:
      oneRepMax = epleyOneRepMax(weight, reps);
      break;
  }

  return {
    oneRepMax,
    formula,
    confidence: repsToConfidence(reps),
  };
}

/**
 * Blend all three formulas to smooth per-formula quirks.
 */
export function estimateOneRepMaxAveraged(input: RepMaxInput): MultiFormulaEstimate {
  if (!isValidInput(input)) {
    return {
      oneRepMax: 0,
      perFormula: { epley: 0, brzycki: 0, lombardi: 0 },
      confidence: 0,
    };
  }
  const epley = epleyOneRepMax(input.weight, input.reps);
  const brzycki = brzyckiOneRepMax(input.weight, input.reps);
  const lombardi = lombardiOneRepMax(input.weight, input.reps);
  const oneRepMax = round((epley + brzycki + lombardi) / 3);
  return {
    oneRepMax,
    perFormula: { epley, brzycki, lombardi },
    confidence: repsToConfidence(input.reps),
  };
}

/**
 * Pick the highest 1RM across a history of sets (best-set method).
 * Returns null when the history has no valid sets.
 */
export function bestOneRepMaxFromHistory(
  history: RepMaxInput[],
  formula: RepMaxFormula = 'epley',
): RepMaxEstimate | null {
  let best: RepMaxEstimate | null = null;
  for (const entry of history) {
    const est = estimateOneRepMax(entry, formula);
    if (est.oneRepMax <= 0) continue;
    if (!best || est.oneRepMax > best.oneRepMax) {
      best = est;
    }
  }
  return best;
}

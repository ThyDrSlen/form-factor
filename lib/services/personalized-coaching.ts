/** Personal associations only; never a recovery diagnosis or a muscle-growth estimate. */
export interface PersonalFormObservation {
  id: string;
  exercise: string;
  startAt: number;
  endAt: number;
  restHours: number | null;
  fqi: number | null;
}
export interface PersonalFormRep {
  rep_id: string;
  session_id: string;
  exercise: string;
  start_ts: string;
  end_ts: string;
  fqi: number | null;
}

/** Spacing between tracked bouts is a proxy, NOT total rest: untracked activity is unknown. */
export function buildPersonalFormObservations(reps: PersonalFormRep[]): PersonalFormObservation[] {
  const seen = new Set<string>();
  const groups = new Map<string, PersonalFormObservation & { values: number[] }>();
  for (const rep of reps) {
    const startAt = Date.parse(rep.start_ts), endAt = Date.parse(rep.end_ts);
    if (seen.has(rep.rep_id) || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) continue;
    seen.add(rep.rep_id);
    const key = `${rep.session_id}:${rep.exercise}`;
    const group = groups.get(key) ?? { id: rep.session_id, exercise: rep.exercise, startAt, endAt, restHours: null, fqi: null, values: [] };
    group.startAt = Math.min(startAt, group.startAt);
    group.endAt = Math.max(endAt, group.endAt);
    if (rep.fqi !== null && Number.isFinite(rep.fqi) && rep.fqi >= 0 && rep.fqi <= 100) group.values.push(rep.fqi);
    groups.set(key, group);
  }
  const previous = new Map<string, number>();
  return [...groups.values()].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id)).map(({ values, ...row }) => {
    const priorEnd = previous.get(row.exercise);
    previous.set(row.exercise, Math.max(priorEnd ?? 0, row.endAt));
    return { ...row, fqi: values.length >= 3 ? mean(values) : null, restHours: priorEnd === undefined ? null : (row.startAt - priorEnd) / 3600000 };
  });
}

export interface TrainingProxySet { id: string; set_type: string; actual_reps: number | null }

/** Transparent narrow rule, deliberately NOT an overall hypertrophy or effort score. */
export function rateHypertrophyTraining(sets: TrainingProxySet[]) {
  const unique = [...new Map(sets.map(set => [set.id, set])).values()];
  const working = unique.filter(set => ['normal', 'dropset', 'amrap', 'failure'].includes(set.set_type));
  const known = working.filter(set => set.actual_reps !== null && Number.isInteger(set.actual_reps) && set.actual_reps > 0);
  const inRange = known.filter(set => set.actual_reps! >= 5 && set.actual_reps! <= 30);
  return {
    score: known.length >= 3 ? Math.round(100 * inRange.length / known.length) : null,
    eligibleSets: known.length, inRangeSets: inRange.length,
    unknownSets: working.length - known.length, excludedSets: unique.length - working.length,
    overallQuality: null,
    limitations: ['Effort / proximity to failure is unknown.', 'Muscle-specific volume, progression and technique are not rated.', 'This is not a muscle-growth measurement. Sets outside 5–30 reps can still be productive.'],
  };
}

export interface PersonalFormLearning {
  status: 'insufficient' | 'not-validated' | 'validated';
  confidence: 'insufficient' | 'tentative';
  exercise: string | null;
  sampleCount: number;
  trainCount: number;
  holdoutCount: number;
  trainEnd: number | null;
  holdoutStart: number | null;
  baselineMae: number | null;
  modelMae: number | null;
  model: { slope: number; intercept: number; minHours: number; maxHours: number } | null;
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Fixed one-feature ridge regression. Last 30% held out, never used to fit or tune.
 * Heuristic eligibility gates, NOT statistical significance or causal evidence.
 */
export function learnPersonalForm(observations: PersonalFormObservation[]): PersonalFormLearning {
  const seen = new Set<string>();
  const days = new Set<string>();
  const groups = new Map<string, PersonalFormObservation[]>();
  for (const row of [...observations].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id))) {
    if (!Number.isFinite(row.startAt) || !Number.isFinite(row.endAt) || row.endAt < row.startAt ||
      row.fqi === null || !Number.isFinite(row.fqi) || row.fqi < 0 || row.fqi > 100 ||
      row.restHours === null || !Number.isFinite(row.restHours) || row.restHours < 6 || row.restHours > 168 || !row.exercise) continue;
    const key = `${row.exercise}:${row.id}`;
    const day = `${row.exercise}:${Math.floor(row.startAt / 86400000)}`;
    if (seen.has(key) || days.has(day)) continue;
    seen.add(key); days.add(day);
    groups.set(row.exercise, [...(groups.get(row.exercise) ?? []), row]);
  }
  // Select by coverage only, never by strongest association (no multiple-feature fishing).
  const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]?.[1] ?? [];
  const split = Math.floor(rows.length * 0.7);
  const train = rows.slice(0, split);
  const holdout = rows.slice(split);
  const result: PersonalFormLearning = {
    status: 'insufficient', confidence: 'insufficient', exercise: rows[0]?.exercise ?? null,
    sampleCount: rows.length, trainCount: train.length, holdoutCount: holdout.length,
    trainEnd: train.at(-1)?.endAt ?? null, holdoutStart: holdout[0]?.startAt ?? null,
    baselineMae: null, modelMae: null, model: null,
  };
  if (train.length < 20 || holdout.length < 10) return result;
  const xs = train.map(row => row.restHours!);
  const ys = train.map(row => row.fqi!);
  const mx = mean(xs), my = mean(ys);
  const variance = mean(xs.map(x => (x - mx) ** 2));
  if (variance < 4) return result;
  // Standardized ridge with fixed lambda=4, expressed back in hours.
  const covariance = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const slope = covariance / variance * train.length / (train.length + 4);
  const model = { slope, intercept: my - slope * mx, minHours: Math.min(...xs), maxHours: Math.max(...xs) };
  const predict = (x: number) => Math.max(0, Math.min(100, model.intercept + slope * x));
  const modelMae = mean(holdout.map(row => Math.abs(row.fqi! - predict(row.restHours!))));
  const baselineMae = mean(holdout.map(row => Math.abs(row.fqi! - my)));
  const inRange = holdout.every(row => row.restHours! >= model.minHours && row.restHours! <= model.maxHours);
  const separated = train.every(row => row.endAt < holdout[0].startAt);
  const validated = inRange && separated && baselineMae - modelMae >= 1 && modelMae < baselineMae * 0.9;
  return { ...result, model, modelMae, baselineMae, status: validated ? 'validated' : 'not-validated', confidence: validated ? 'tentative' : 'insufficient' };
}

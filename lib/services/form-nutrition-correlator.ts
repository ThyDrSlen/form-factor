/**
 * Form × Nutrition correlator (issue #470).
 *
 * Pure TypeScript. No network, no storage, no side effects. Given a flat list
 * of form-tracking session summaries (each with an average FQI and a
 * timestamp) plus a flat list of food entries, compute correlations between
 * pre-workout nutrition windows and session quality.
 *
 * The shape is intentionally compact:
 *   - Pearson r, slope, R² and a sample count per feature.
 *   - A `significance` tag ("low" | "medium" | "high") that downstream UI
 *     uses to decide whether to render the insight at all.
 *   - Three derived insights: protein-high-day FQI lift, carb-timing,
 *     pre-workout meal proximity.
 *
 * The math is standard Pearson correlation; kept inline so this file has
 * zero imports and is trivially unit-testable.
 */
import type { FoodEntry } from '@/contexts/FoodContext';

export interface FormSession {
  /** Stable session identifier. */
  id: string;
  /** Session start time — either ISO string or millisecond epoch. */
  startAt: string | number;
  /** Average FQI for the session. May be null when no reps were logged. */
  avgFqi: number | null;
}

export interface NutritionCorrelationMetric {
  /** Pearson correlation coefficient, clamped to [-1, 1]. */
  r: number;
  /** Linear slope (FQI units per 1 unit of the predictor). */
  slope: number;
  /** Coefficient of determination (r²). */
  r2: number;
  /** Number of paired samples used. */
  sampleCount: number;
  /** Heuristic confidence tag, consumed by UI gating. */
  significance: 'low' | 'medium' | 'high';
}

export interface NutritionFormInsight {
  id: 'protein_high' | 'carb_timing' | 'meal_proximity';
  title: string;
  description: string;
  metric: NutritionCorrelationMetric;
}

export interface NutritionFormCorrelation {
  windowHours: number;
  proteinVsFqi: NutritionCorrelationMetric;
  carbsVsFqi: NutritionCorrelationMetric;
  caloriesVsFqi: NutritionCorrelationMetric;
  mealProximityMinVsFqi: NutritionCorrelationMetric;
  insights: NutritionFormInsight[];
  sampleCount: number;
}

export interface CorrelateNutritionOptions {
  /** +/- N hour window around session start for meal-to-session joins. Default 3h. */
  windowHours?: number;
  /** High-protein threshold in grams for the protein insight. Default 30 g. */
  proteinHighGrams?: number;
}

const EMPTY_METRIC: NutritionCorrelationMetric = {
  r: 0,
  slope: 0,
  r2: 0,
  sampleCount: 0,
  significance: 'low',
};

function toEpoch(value: string | number): number {
  if (typeof value === 'number') return value;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function pearson(xs: number[], ys: number[]): NutritionCorrelationMetric {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) {
    return { ...EMPTY_METRIC, sampleCount: n };
  }
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) {
    return { ...EMPTY_METRIC, sampleCount: n };
  }
  const r = numerator / Math.sqrt(denomX * denomY);
  const clampedR = Math.max(-1, Math.min(1, r));
  const slope = numerator / denomX;
  const r2 = clampedR * clampedR;
  const absR = Math.abs(clampedR);
  let significance: NutritionCorrelationMetric['significance'] = 'low';
  if (n >= 10 && absR >= 0.5) significance = 'high';
  else if (n >= 5 && absR >= 0.3) significance = 'medium';
  return {
    r: Number(clampedR.toFixed(4)),
    slope: Number(slope.toFixed(4)),
    r2: Number(r2.toFixed(4)),
    sampleCount: n,
    significance,
  };
}

interface SessionFeatures {
  avgFqi: number;
  proteinG: number;
  carbsG: number;
  calories: number;
  minutesSinceMeal: number; // very large when no meal was found in window
}

const NO_MEAL_MINUTES = 60 * 24; // 24h sentinel — kept monotonic so correlations treat "no meal" as distant

function computeFeatures(
  sessions: FormSession[],
  foodEntries: FoodEntry[],
  windowHours: number,
): SessionFeatures[] {
  const windowMs = windowHours * 60 * 60 * 1000;
  const results: SessionFeatures[] = [];
  for (const session of sessions) {
    if (session.avgFqi === null || !Number.isFinite(session.avgFqi)) continue;
    const sessionMs = toEpoch(session.startAt);
    if (!sessionMs) continue;

    let proteinG = 0;
    let carbsG = 0;
    let calories = 0;
    let closestMealDelta = Number.POSITIVE_INFINITY;

    for (const food of foodEntries) {
      const foodMs = toEpoch(food.date);
      if (!foodMs) continue;
      const delta = Math.abs(foodMs - sessionMs);
      if (delta <= windowMs) {
        proteinG += food.protein ?? 0;
        carbsG += food.carbs ?? 0;
        calories += food.calories ?? 0;
        // Only count meals within the window toward proximity — a meal outside
        // the window would erase the "proximity" signal entirely.
        if (delta < closestMealDelta) closestMealDelta = delta;
      }
    }

    const minutesSinceMeal =
      closestMealDelta === Number.POSITIVE_INFINITY
        ? NO_MEAL_MINUTES
        : Math.round(closestMealDelta / 60000);

    results.push({
      avgFqi: session.avgFqi,
      proteinG,
      carbsG,
      calories,
      minutesSinceMeal,
    });
  }
  return results;
}

function buildProteinInsight(
  features: SessionFeatures[],
  proteinHighGrams: number,
  metric: NutritionCorrelationMetric,
): NutritionFormInsight {
  const hi = features.filter((f) => f.proteinG >= proteinHighGrams).map((f) => f.avgFqi);
  const lo = features.filter((f) => f.proteinG < proteinHighGrams).map((f) => f.avgFqi);
  const hiAvg = hi.length > 0 ? mean(hi) : null;
  const loAvg = lo.length > 0 ? mean(lo) : null;
  const diff = hiAvg !== null && loAvg !== null ? hiAvg - loAvg : 0;
  const description =
    hiAvg === null || loAvg === null
      ? 'Not enough high-protein days yet.'
      : diff >= 0
        ? `FQI averages ${diff.toFixed(1)} pts higher on days you ate ≥${proteinHighGrams}g protein in your ±window.`
        : `FQI averages ${Math.abs(diff).toFixed(1)} pts lower on high-protein days — could be coincidence with small sample.`;
  return {
    id: 'protein_high',
    title: 'Protein × form',
    description,
    metric,
  };
}

function buildCarbInsight(metric: NutritionCorrelationMetric): NutritionFormInsight {
  const direction = metric.slope > 0 ? 'higher' : 'lower';
  const description =
    metric.sampleCount < 5
      ? 'Log a few more workouts to unlock carb-timing insight.'
      : metric.significance === 'low'
        ? 'No clear link between carb timing and FQI yet.'
        : `Sessions tend to have ${direction} FQI when carbs land inside your pre-workout window (r=${metric.r.toFixed(2)}).`;
  return {
    id: 'carb_timing',
    title: 'Carb timing × form',
    description,
    metric,
  };
}

function buildMealProximityInsight(metric: NutritionCorrelationMetric): NutritionFormInsight {
  // metric.slope is FQI per +1 minute since last meal; negative slope means
  // "closer meal = better FQI", which tends to be the interesting signal.
  const direction = metric.slope < 0 ? 'closer' : 'further from';
  const description =
    metric.sampleCount < 5
      ? 'Not enough paired meals/sessions to judge meal proximity yet.'
      : metric.significance === 'low'
        ? 'Meal proximity does not obviously affect your FQI.'
        : `Your FQI trends up when your last meal is ${direction} the session (r=${metric.r.toFixed(2)}).`;
  return {
    id: 'meal_proximity',
    title: 'Meal proximity × form',
    description,
    metric,
  };
}

export function correlateNutritionWithForm(
  sessions: FormSession[],
  foodEntries: FoodEntry[],
  opts: CorrelateNutritionOptions = {},
): NutritionFormCorrelation {
  const windowHours = opts.windowHours ?? 3;
  const proteinHighGrams = opts.proteinHighGrams ?? 30;

  if (sessions.length === 0 || foodEntries.length === 0) {
    return {
      windowHours,
      proteinVsFqi: EMPTY_METRIC,
      carbsVsFqi: EMPTY_METRIC,
      caloriesVsFqi: EMPTY_METRIC,
      mealProximityMinVsFqi: EMPTY_METRIC,
      insights: [],
      sampleCount: 0,
    };
  }

  const features = computeFeatures(sessions, foodEntries, windowHours);
  if (features.length === 0) {
    return {
      windowHours,
      proteinVsFqi: EMPTY_METRIC,
      carbsVsFqi: EMPTY_METRIC,
      caloriesVsFqi: EMPTY_METRIC,
      mealProximityMinVsFqi: EMPTY_METRIC,
      insights: [],
      sampleCount: 0,
    };
  }

  const fqi = features.map((f) => f.avgFqi);
  const proteinVsFqi = pearson(
    features.map((f) => f.proteinG),
    fqi,
  );
  const carbsVsFqi = pearson(
    features.map((f) => f.carbsG),
    fqi,
  );
  const caloriesVsFqi = pearson(
    features.map((f) => f.calories),
    fqi,
  );
  const mealProximityMinVsFqi = pearson(
    features.map((f) => f.minutesSinceMeal),
    fqi,
  );

  const insights: NutritionFormInsight[] = [
    buildProteinInsight(features, proteinHighGrams, proteinVsFqi),
    buildCarbInsight(carbsVsFqi),
    buildMealProximityInsight(mealProximityMinVsFqi),
  ];

  return {
    windowHours,
    proteinVsFqi,
    carbsVsFqi,
    caloriesVsFqi,
    mealProximityMinVsFqi,
    insights,
    sampleCount: features.length,
  };
}

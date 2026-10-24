/** Workout loads are persisted in pounds; HealthKit body mass remains kilograms.
 * No historical rows are rewritten: see docs/WORKOUT_WEIGHT_UNITS.md.
 */
export type WorkoutWeightUnit = 'lbs' | 'kg';
export const POUNDS_PER_KILOGRAM = 2.20462;

export function workoutWeightFromPounds(pounds: number, unit: string): number {
  return unit === 'kg' ? pounds / POUNDS_PER_KILOGRAM : pounds;
}

export function workoutWeightToPounds(value: number, unit: WorkoutWeightUnit): number {
  return unit === 'kg' ? value * POUNDS_PER_KILOGRAM : value;
}

/** Round only at presentation boundaries, never on persistence. */
export function formatWorkoutWeight(pounds: number, unit: string): string {
  return String(Number(workoutWeightFromPounds(pounds, unit).toFixed(2)));
}

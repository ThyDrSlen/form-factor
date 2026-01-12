# Workout definitions

This folder contains **workout definitions** used by the tracking UI and the rep/FQI pipeline.

Each workout lives in its own file (for example `pullup.ts`, `pushup.ts`) and exports a `WorkoutDefinition` that describes:

- **Phases** (`phases`, `initialPhase`): a small state machine for the movement (e.g. `hang → pull → top`)
- **Rep boundaries** (`repBoundary`): which phase transitions start/end a rep
- **Thresholds** (`thresholds`): numeric cutoffs used by the state machine and cues
- **Metrics** (`calculateMetrics`): per-frame derived values from joint angles (and optional joint positions)
- **Phase transition** (`getNextPhase`): “given phase + angles + metrics, what phase is next?”
- **UI adapter** (`ui`): icon/labels + watch/upload metrics shaping + optional realtime cues
- **Faults / scoring** (`faults`, `fqiWeights`, `scoringMetrics`): used by the FQI calculator + rep logging

## Adding a new workout

1. Create a new file: `lib/workouts/<id>.ts`
2. Implement and export a definition:
   - `export type <Workout>Phase = ...`
   - `export interface <Workout>Metrics extends WorkoutMetrics { ... }`
   - `export const <WORKOUT>_THRESHOLDS = { ... } as const`
   - `export const <id>Definition: WorkoutDefinition<<Workout>Phase, <Workout>Metrics> = { ... }`
   - Include `ui` so the tracker/watch can consume the workout without hard-coded logic in `scan-arkit.tsx`
3. Register it in `lib/workouts/index.ts`:
   - Import `<id>Definition`
   - Add it to `workoutsByMode`
   - Add it to `workoutRegistry`
   - `DetectionMode` is derived from `workoutsByMode` keys (no manual union)

## Notes

- Prefer keeping **all** workout-specific heuristics inside the workout file (not in `scan-arkit.tsx`).
- Keep thresholds named and documented (avoid magic numbers sprinkled through the UI).
- If you need a new metric for UI/telemetry, add it to that workout’s `Metrics` type and compute it in `calculateMetrics`.

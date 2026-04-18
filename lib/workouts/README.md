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
- If you need a new metric for UI/telemetry, add it to that workout's `Metrics` type and compute it in `calculateMetrics`.

## Registered movements (as of #459)

| ID | Category | Faults | Gotchas |
|---|---|---|---|
| `pullup` | upper_body | 2 | Bilateral vertical pull |
| `pushup` | upper_body | 2 | Hip sag via hipDropRatio |
| `squat` | lower_body | 4 | Parallel depth, knee valgus, hip shift |
| `deadlift` | full_body | 2 | Sequence-based rounded_back |
| `rdl` | full_body | 1 | Hinge asymmetry |
| `benchpress` | upper_body | 5 | Elbow flare, asymmetric press |
| `dead_hang` | upper_body | 3 (core) + scapular/kipping/grip_shift when merged from #441 | Static hold — no rep boundary |
| `farmers_walk` | full_body | 1 | Duration-based; lateral lean |
| `hip_thrust` | lower_body | 5 | Heel-liftoff proxy: knee-angle asymmetry |
| `bulgarian_split_squat` | lower_body | 4 | Unilateral — deeper-knee = working leg |
| `barbell_row` | upper_body | 4 | Rounded-back via hip-vs-shoulder sequenceCheck |
| `lat_pulldown` | upper_body | 4 | Seated — excessive-lean via shoulder delta |
| `overhead_press` | upper_body | 4 | Core hyperextension via peak-hip angle |
| `dumbbell_curl` | upper_body | 3 | Swinging via hip-flex delta proxy |

## Coach-drill backfill (follow-up)

`FaultDefinition` does not yet carry a `drills` field. Once #434 lands and
introduces `drills?: FaultDrill[]`, a follow-up PR will backfill 1-3
corrective drills per fault across **all** movements (including the 6 new
ones added here). Until then, the `dynamicCue` string carries the lone
corrective message for each fault.

## Helper reconcile note (#441 + #459)

`lib/workouts/helpers.ts` is currently duplicated between this PR and
`feat/438-form-model-depth` (#441). Both PRs carry identical content —
whichever merges second should delete its TODO(#438) reconcile comment
but needs no other action because the files are byte-for-byte identical.

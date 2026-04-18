# Overnight changelog

Non-code changes and cross-PR notes from overnight / parallel-agent work.
See git log for the atomic commit detail; this file captures the higher-
level "what wave shipped" narrative for quick reviewer context.

## 2026-04-16 — Exercise library expansion (#459)

Adds 6 compound/accessory form models to `lib/workouts/` following the
pattern established by #441 (lunge + extended dead-hang):

- `hip_thrust` — 5 faults (shallow_depth / heel_liftoff / incomplete_lockout /
  asymmetric_extension / hyperextension)
- `bulgarian_split_squat` — 4 faults (shallow_depth / forward_knee /
  asymmetric_drive / heel_collapse); unilateral working-leg selection by
  deeper-knee proxy matching lunge.
- `barbell_row` — 4 faults (incomplete_lockout / rounded_back via
  sequenceCheck / asymmetric_pull / elbows_high)
- `lat_pulldown` — 4 faults (incomplete_lockout / excessive_lean via
  shoulder delta / asymmetric_pull / elbows_flare at bottom-of-pull)
- `overhead_press` — 4 faults (incomplete_lockout / excessive_lean /
  asymmetric_press / core_hyperextension via peak-hip angle)
- `dumbbell_curl` — 3 faults (swinging via hip-flex delta / incomplete_lockout
  / asymmetric_curl); forearm supination intentionally not trackable.

### Judgment calls (sparse sensors)

`JointAngles` has no wrist, ankle, foot, or spine channel, so several
faults use proxies documented inline per-file:

- hip_thrust `heel_liftoff`: knee-angle asymmetry at peak extension stands
  in for foot-planted-vs-lifted.
- BSS `heel_collapse`: extreme acute front-knee angle proxies a collapsed arch.
- barbell_row `rounded_back`: `sequenceCheck(hip-delta, shoulder-delta)`
  flags spine flexion via relative joint movement.
- lat_pulldown `excessive_lean` / overhead_press `excessive_lean` /
  dumbbell_curl `swinging`: all use `clampedDelta(startHip, minHip)` on the
  hip channel — torso-rotation sensors don't exist in the current fusion.
- dumbbell_curl: no supination fault (no wrist-rotation sensor).

### Helper reconcile note

`lib/workouts/helpers.ts` landed on this PR as a byte-identical copy of
`feat/438-form-model-depth` (#441). PR-N / #452 used the same
copy-then-reconcile pattern for `subject-identity.ts`. Whichever PR merges
second needs only to drop the TODO(#438) comment — no content changes.

### Coverage delta

- 6 new movement form-model files: `hip-thrust`, `bulgarian-split-squat`,
  `barbell-row`, `lat-pulldown`, `overhead-press`, `dumbbell-curl`.
- 6 new per-movement test suites (hip-thrust 22, BSS 19, row 19, lat-PD 19,
  OHP 19, DB-curl 16 → 114 tests).
- 1 new parametric harness covering every fault (24 faults × 3 layers
  [baseline / positive / NaN-guard] = 72 cases + 1 cardinality check = 73).
- Extended `workouts-factory.test.ts` by +36 assertions across the 6 new
  modes (getWorkoutByMode / isDetectionMode / isValidWorkoutId /
  getWorkoutById) and a DetectionMode-cardinality check (14 total modes).

### Deferrals

- Coach-drill (`drills?: FaultDrill[]`) backfill — waits on #434 to
  introduce the field.
- Leg press / hack squat / incline variants — separate L-effort PR.
- Supabase workout-template seeds referencing the new IDs — needs a
  migration and was intentionally skipped (banned path).

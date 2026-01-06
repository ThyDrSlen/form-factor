# Rep Index Alignment and Generalization Decisions

## Scope
- Address pre-pipeline issues that block correct ML slicing and create drift risk:
  - `pose_samples.rep_number` does not align with `reps.rep_index`.
  - `app/(tabs)/scan-arkit.tsx` contains duplicated, exercise-specific rep state machines that overlap with `lib/workouts/*`.
  - `lib/services/fqi-calculator.ts` scoring logic is partially hard-coded by joint keys and does not scale to new movements.

## Decision summary (proposed)
- D1: Define `pose_samples.rep_number` as the active `rep_index` (1-indexed) for frames that belong to a rep; use `0` when not in an active rep.
- D2: Replace exercise-specific rep cycle logic in `app/(tabs)/scan-arkit.tsx` with a generic runtime driven by `WorkoutDefinition`:
  - `calculateMetrics`
  - `getNextPhase`
  - `repBoundary`
- D3: Make `lib/services/fqi-calculator.ts` use per-workout scoring metric extractors instead of hard-coded joint key branches.

## Issue A: `pose_samples.rep_number` off by 1 vs `reps.rep_index`

### Observed behavior
- Frames are logged with:
  - `repNumber = currentReps` where `currentReps` is `repCount` (pull-up) or `pushUpReps` (push-up).
  - `repCount` and `pushUpReps` represent completed rep count.
  - At rep completion, the code does `newRepCount = repCount + 1` and logs the rep row as `repIndex = newRepCount`.
- Result:
  - Frames for rep 1 are stored with `pose_samples.rep_number = 0`.
  - The rep row is stored with `reps.rep_index = 1`.
  - Joining frames to reps by `(session_id, rep_number == rep_index)` mislabels every rep.

### Why this blocks ML workflows
- `pose_samples.frame_timestamp` is an ARKit timestamp (`double precision`).
- `reps.start_ts` and `reps.end_ts` are wall-clock timestamps (`timestamptz`) generated via `Date.now()` and ISO strings.
- A time-based join is not reliable without a defined shared clock domain.
- Therefore, rep slicing must use a consistent rep index label on both:
  - `pose_samples.rep_number`
  - `reps.rep_index`

### Options
- Option A0 (status quo): Keep mismatch and fix joins by `rep_index = rep_number + 1`.
  - Rejected.
  - Old semantics also label rest frames between reps with incremented `rep_number`, so `+1` shifts non-rep frames into the next rep bucket.
- Option A1: Define `pose_samples.rep_number = completedRepCount`.
  - Rejected.
  - This is the current behavior and is not a join key to `reps.rep_index`.
- Option A2 (recommended): Define `pose_samples.rep_number = activeRepIndex` for frames while a rep is being tracked; use `0` outside reps.
  - Accepted (D1).
  - Provides a clean join key for rep slicing with `pose_samples.rep_number == reps.rep_index`.
  - Avoids pre-rep/rest frames being included in a rep bucket.

### Implementation plan (minimal, local to `scan-arkit.tsx`)
- Introduce:
  - `activeRepIndexRef: React.MutableRefObject<number>` initialized to `0`.
  - `completedRepCountRef: React.MutableRefObject<number>` (optional) to avoid relying on React state for logging.
- On rep start (`startRepTracking` call site):
  - Set `activeRepIndexRef.current = completedCount + 1` where `completedCount` is the exercise’s completed rep count.
- While logging pose frames:
  - Set `repNumber = activeRepIndexRef.current` (not `repCount` or `pushUpReps`).
  - Set `phase` from the synchronous phase refs (avoid React state lag):
    - pull-up: `phaseRef.current`
    - push-up: `pushUpStateRef.current`
- On rep completion (`completeRepTracking`):
  - Pass `repNumber = activeRepIndexRef.current`.
  - After successful completion (or regardless, if tracking is reset), set `activeRepIndexRef.current = 0`.
  - Increment the completed rep count state as UI-only (`setRepCount`, `setPushUpReps`).
- On rep abort paths:
  - When pose is lost, tracking stops, or detectionMode switches:
    - reset `repStartTsRef.current = 0` and `activeRepIndexRef.current = 0` to avoid "stuck active rep".

### Acceptance checks
- For a session with N reps:
  - Exactly the frames during rep k have `pose_samples.rep_number == k`.
  - Frames outside reps have `pose_samples.rep_number == 0`.
  - Each `reps` row uses `rep_index == k`.
  - Joining by `(session_id, rep_number)` yields the correct rep windows.

## Issue B: duplicated rep FSM logic in `scan-arkit.tsx`

### Observed behavior
- `lib/workouts/pullup.ts` and `lib/workouts/pushup.ts` define:
  - phases
  - thresholds
  - `calculateMetrics`
  - `getNextPhase`
  - `repBoundary` including `minDurationMs`
- `app/(tabs)/scan-arkit.tsx` still contains a separate, parallel FSM:
  - `updatePullUpCycle` and `updatePushUpCycle`
  - hard-coded thresholds usage and debounce (`400`)
  - separate phase state refs and React state updates
- Result:
  - Two sources of truth for phase transitions and rep boundaries.
  - Any threshold change requires edits in multiple files.
  - Adding `squat` will copy-paste this pattern and increase drift risk.

### Options
- Option B0: Keep duplicated logic.
  - Rejected.
  - Drift risk scales linearly with number of movements and adjustments.
- Option B1 (recommended): Keep `WorkoutDefinition` as the single source of truth for:
  - metric computation
  - phase transitions
  - rep boundary debounce and completion
  - and have `scan-arkit.tsx` run the generic loop.
  - Accepted (D2).

### Implementation plan (incremental)
- Define a generic per-frame runner:
  - `def = getWorkoutById(detectionMode)`
  - `metrics = def.calculateMetrics(angles, jointsMap)`
  - `nextPhase = def.getNextPhase(currentPhase, angles, metrics)`
  - `currentPhase = nextPhase`
- Implement generic rep boundary tracker driven by `def.repBoundary`:
  - Rep start triggers when transitioning into `def.repBoundary.startPhase`.
  - Rep complete triggers when transitioning into `def.repBoundary.endPhase` while a rep is active and `minDurationMs` has elapsed.
  - Call `startRepTracking` and `completeRepTracking` using the shared tracker state.
- Remove or deprecate:
  - `updatePullUpCycle`
  - `updatePushUpCycle`
  - local hard-coded debounce constants in the FSM paths
- Keep existing higher-level UI and speech feedback logic initially.

### Acceptance checks
- Changing thresholds in `lib/workouts/*` changes runtime behavior without editing `scan-arkit.tsx`.
- Rep counting and phase displays remain stable for pull-ups and push-ups.
- Adding a new workout definition only requires adding a `WorkoutDefinition` module and registering it.

## Issue C: FQI scoring generalization

### Observed behavior
- `lib/services/fqi-calculator.ts`:
  - uses string keys like `angleRanges.elbow`, `angleRanges.shoulder`, `angleRanges.knee`, `angleRanges.hip`
  - and maps them to fixed `JointAngles` fields.
- Result:
  - Adding a new scored concept (torso lean, pelvis sway, hipBelowKnee) requires adding new `if` blocks and new joint field mapping code.

### Options
- Option C0: Keep hard-coded joint mappings.
  - Rejected.
  - Each new exercise expands `fqi-calculator.ts` with bespoke code.
- Option C1 (recommended): Add per-workout scoring metric extractors to `WorkoutDefinition`.
  - Accepted (D3).
  - This is a minimal bridge toward the later metric-driven pipeline.

### Proposed API surface (bridge, not the final pipeline)
- Extend `WorkoutDefinition` with optional `scoringMetrics`:
  - `id: string` stable identifier (should match `angleRanges` key when using `AngleRange`)
  - `extract: (repAngles: RepAngles, side: 'left' | 'right') => { start: number; end: number; min: number; max: number }`
- Update `calculateFqi` to:
  - loop over `workoutDef.scoringMetrics`
  - use `workoutDef.angleRanges[metric.id]` when present
  - compute ROM and depth using generic logic over extracted scalar series
- Keep `faults` as-is initially (rep-level rules already live in `WorkoutDefinition.faults`).

### Acceptance checks
- Adding a new scored metric does not require editing `lib/services/fqi-calculator.ts` if the workout definition provides an extractor.
- Existing pull-up and push-up scores remain within expected tolerances (same thresholds, same weights).

## Open questions (need confirmation)
- Q1: For frames outside a rep, should `pose_samples.rep_number` be `0` (recommended) or `NULL`?
- Q2: Should pose frame logging use phase refs (`phaseRef.current`, `pushUpStateRef.current`) as the source of truth for `pose_samples.phase`?


# Form Tracking Hardening — Loop Prompt

> **Goal**: Systematically improve form/pose detection accuracy, rep counting reliability, and tracking robustness across ALL body orientations (front-facing, back-facing, side-angle). This is the "Form" in "Form Factor" — the single most critical feature in the app.

> **Constraint**: All improvements MUST be validated offline via fixtures, unit tests, and eval scripts — NO manual iPhone testing required. Every code change must produce measurable metric improvements before moving to the next.

---

## Phase 0: Establish Baseline (DO THIS FIRST — NEVER SKIP)

### 0a. Run existing eval suite and capture baseline metrics

```bash
bun run scripts/eval-pullup-tracking.ts --format=json > /tmp/form-baseline-before.json
bun run scripts/baseline-pullup-tracking.ts > /tmp/form-baseline-raw.txt
bun test tests/unit/tracking-quality/rep-detector.test.ts
bun test tests/unit/fusion/phase-fsm.test.ts
bun test tests/unit/tracking-quality/scoring.test.ts
bun test tests/unit/workout-runtime.test.ts
```

Record these metrics as the "before" snapshot:
- **Rep accuracy** per fixture: `abs(actual_reps - expected_reps)` for all 5 scenarios (camera-facing, back-turned, occlusion-brief, occlusion-long, bounce-noise)
- **Partial frame %** per fixture
- **Cue flip rate** (raw and hysteresis-stabilized)
- **Mean frame latency** and latency bucket distribution
- **Mean FQI score** per fixture
- **All tests passing?** Record any failures.

Save this baseline. You will compare against it after EVERY change.

### 0b. Export real pose data from Supabase for regression testing

Query the `pose_samples` table for recent pullup sessions to create real-world fixture data:

```bash
supabase db query --experimental --linked \
  "SELECT frame_timestamp, phase, rep_number, \
    left_elbow_deg, right_elbow_deg, left_shoulder_deg, right_shoulder_deg, \
    left_knee_deg, right_knee_deg, left_hip_deg, right_hip_deg, \
    joint_positions, pose_confidence, fps_at_capture, inference_ms, \
    shadow_mean_abs_delta, shadow_coverage_ratio \
  FROM pose_samples \
  WHERE exercise_mode = 'pullup' \
  AND created_at > NOW() - INTERVAL '7 days' \
  ORDER BY session_id, frame_timestamp" \
  -o json > /tmp/real-pose-data.json
```

Analyze this data:
- How many sessions? How many frames per session?
- What's the distribution of phases? (idle, hang, pull, top)
- What's the angle range for elbows across phases?
- Are there frames with NULL or 0 angles? (indicates tracking loss)
- What's the shadow_mean_abs_delta distribution? (tracking quality proxy)
- What's the pose_confidence distribution?

### 0c. Identify gaps in fixture coverage

Compare the synthetic fixtures against the real pose data:
- Do the synthetic angle ranges match real-world ranges?
- Is the noise level realistic? (Compare fixture noise to real shadow_mean_abs_delta)
- The `back-turned` fixture only has 1 rep — we need multi-rep back-facing scenarios
- Are there scenarios missing? (e.g., transition from front to back mid-set, side angle, fatigue degradation)

---

## Phase 1: Expand Fixture Corpus with Real-World Scenarios

### 1a. Create new fixture scenarios in `lib/debug/pullup-fixture-corpus.ts`

Add these scenarios to the corpus builder:

1. **`back-turned-multi`** — 3+ reps back-facing, based on real pose data patterns
   - Higher noise (1.6-2.0 deg) for back-facing
   - Intermittent tracking gaps (isTracked flickers on extension phases)
   - Expected: 3 reps (validates multi-rep back-facing)

2. **`back-turned-no-deadhang`** — Back-facing reps without full arm extension between reps
   - Elbow only returns to ~120-130 deg between reps (not 150+)
   - Tests the `release: 115` threshold fix we applied
   - Expected: 3 reps

3. **`vertical-displacement`** — Scenario with degraded angle data but clear vertical Y movement
   - Shoulder Y-position oscillates 0.15-0.20 in normalized coords (significant vertical travel)
   - Elbow angles are noisy/unreliable (high noise, intermittent NaN)
   - Tests vertical displacement fallback signal
   - Expected: 2 reps (validated by vertical signal alone)

4. **`side-angle`** — Camera at ~45 degree angle to user
   - One side's joints have higher confidence than the other
   - Asymmetric angle accuracy (near-side reliable, far-side noisy)
   - Expected: 2 reps

5. **`fatigue-degradation`** — Form degrades over a set
   - First 3 reps: full ROM, clean angles
   - Last 2 reps: reduced ROM (elbow only reaches 95 instead of 85), slower tempo
   - Expected: 5 reps total (all should count despite degraded form)

6. **`tracking-dropout-recovery`** — Clean tracking, 1.5s total dropout, then recovery
   - Unlike occlusion-brief which drops tracking within a rep, this drops BETWEEN reps
   - Tests that the FSM recovers cleanly after tracking loss
   - Expected: 2 reps (1 before dropout, 1 after)

After adding scenarios, regenerate fixtures:
```bash
bun run scripts/prepare-pullup-fixtures.ts
```

### 1b. Update eval script to handle new scenarios

Ensure `scripts/eval-pullup-tracking.ts` loads and evaluates all new fixture files. Add metrics:
- **Rep precision**: true_positives / (true_positives + false_positives)
- **Rep recall**: true_positives / (true_positives + false_negatives)
- **Phase transition accuracy**: % of phase transitions within 200ms of expected timing
- **Vertical displacement correlation**: correlation between Y-movement and detected reps (new metric)

### 1c. Update rep-detector tests

Add test cases in `tests/unit/tracking-quality/rep-detector.test.ts` for each new fixture scenario. Each test should assert:
- Correct rep count
- No false positives during rest/idle phases
- Reasonable partial frame percentage

Run all tests to confirm new fixtures work with current code (they should mostly FAIL for back-facing multi-rep — that's expected and gives us a baseline to improve against).

---

## Phase 2: Implement Vertical Displacement Signal

This is the key architectural change. Instead of relying solely on elbow angles (which degrade when back-facing), add a secondary rep detection signal based on vertical body position.

### 2a. Create vertical displacement tracker

**New file**: `lib/tracking-quality/vertical-displacement.ts`

```
Class: VerticalDisplacementTracker
  - Tracks Y-coordinate of reference joints (shoulders, head, hips) over a sliding window
  - Computes smoothed Y-position using EMA (alpha tunable)
  - Detects peaks (local maxima = top of rep) and valleys (local minima = hang/bottom)
  - Outputs: { currentY, smoothedY, velocity, isPeak, isValley, peakToValleyDelta }
  - Configurable: minPeakDelta (minimum Y travel to count as a rep), windowSize, emaAlpha

Key method: processFrame(joints: Record<string, CanonicalJoint2D>): VerticalSignal
  - Pick the best available reference joint (prefer shoulders, fallback to head, then hips)
  - Update EMA-smoothed position
  - Run peak/valley detection with hysteresis (prevent noise-triggered detections)
  - Return signal with confidence based on how many reference joints agree
```

### 2b. Create hybrid rep detector

**New file or modify**: `lib/tracking-quality/hybrid-rep-detector.ts`

Combines angle-based (existing) and vertical-displacement rep detection:

```
Inputs per frame:
  - jointAngles: JointAngles (from ARKit/MediaPipe)
  - joints2D: Record<string, CanonicalJoint2D> (2D joint positions)
  - trackingQuality: number (0-1, from existing confidence system)

Signal fusion strategy:
  - When trackingQuality > 0.7: Trust angles primarily (weight 0.8 angle, 0.2 vertical)
  - When trackingQuality 0.3-0.7: Blend equally (weight 0.5 / 0.5)
  - When trackingQuality < 0.3: Trust vertical primarily (weight 0.2 angle, 0.8 vertical)
  - When angles are NULL/NaN: 100% vertical displacement

Rep counting logic:
  - Both signals must agree within a time window (configurable, e.g., 500ms) for high-confidence rep
  - If only one signal detects a rep and confidence is high enough, count it (prevents missed reps)
  - Cooldown between reps prevents double-counting from signal disagreement
```

### 2c. Write comprehensive unit tests

**New file**: `tests/unit/tracking-quality/vertical-displacement.test.ts`
- Test peak/valley detection with synthetic sinusoidal Y data
- Test EMA smoothing response to step changes and noise
- Test with real-world fixture joint positions

**New file**: `tests/unit/tracking-quality/hybrid-rep-detector.test.ts`
- Test angle-only mode (high quality tracking)
- Test vertical-only mode (degraded tracking)
- Test blended mode (medium quality)
- Test signal disagreement handling
- Run all fixture scenarios through hybrid detector

### 2d. Integrate into workout controller

**Modify**: `hooks/use-workout-controller.ts`
- Add `VerticalDisplacementTracker` as optional secondary signal
- Feed 2D joint positions alongside angles into `processFrame()`
- Use hybrid detection when vertical tracker is enabled

**Modify**: `app/(tabs)/scan-arkit.tsx`
- Pass 2D joint positions to the workout controller
- Enable vertical tracker for all workout modes

### 2e. Validate improvements

```bash
bun run scripts/eval-pullup-tracking.ts --format=json > /tmp/form-after-vertical.json
```

Compare against baseline:
- `back-turned` rep accuracy should improve from 1/1 to working with multi-rep scenarios
- `back-turned-multi` should now pass (3/3 reps detected)
- `vertical-displacement` fixture should pass (2/2 reps via vertical signal)
- `camera-facing` should remain perfect (no regression)
- All existing tests must still pass

---

## Phase 3: Improve Tracking Quality Signals

### 3a. Add joint position stability scoring

**Modify**: `lib/tracking-quality/visibility.ts`

Add a frame-to-frame stability score per joint:
- Track position delta between consecutive frames
- High delta = unstable (likely hallucinated by ARKit)
- Compute rolling variance over 10-frame window
- Derive synthetic confidence: `confidence = 1 - clamp(variance / maxVariance, 0, 1)`
- Use this synthetic confidence in `isJointVisible()` instead of always falling through to `true`

### 3b. Add tracking quality aggregation

**Modify**: `lib/tracking-quality/scoring.ts`

Compute an overall tracking quality score per frame:
- Combine: joint stability scores, coverage ratio, shadow_mean_abs_delta
- Weight critical joints (elbows, shoulders for pullups) more heavily
- Output a single 0-1 quality score that the hybrid rep detector uses for signal weighting

### 3c. Validate

Run eval suite. Check:
- Tracking quality score correlates with known-good vs known-degraded fixture data
- Quality score drops appropriately for `back-turned` and `occlusion-*` scenarios
- Quality score stays high for `camera-facing`

---

## Phase 4: Phase FSM Robustness

### 4a. Audit phase transition thresholds

Read all workout definitions in `lib/workouts/` (pullup.ts, pushup.ts, squat.ts, deadlift.ts, benchpress.ts, etc.).

For each workout:
- Document all thresholds and their purpose
- Check if the same patterns exist (overly strict release/engage thresholds)
- Verify the phase cycle can complete without requiring extreme ROM

### 4b. Add FSM timeout recovery

The phase FSM can get stuck if tracking drops during a transition. Add:
- Timeout per phase (e.g., max 5s in any single phase before auto-reset to idle)
- Clean reset that doesn't lose the current rep count
- Log when timeout fires (for debugging)

### 4c. Test FSM edge cases

Add test cases for:
- Phase stuck at `top` for > 5s (should reset)
- Tracking drops mid-transition (should hold or reset, not count phantom rep)
- Very slow reps (10s per rep — should still count)
- Very fast reps (sub-second — should count if above minDurationMs)

---

## Phase 5: Skeleton Overlay Accuracy

### 5a. Audit overlay rendering

Read `app/(tabs)/scan-arkit.tsx` lines 2523-2626 (skeleton overlay rendering).
- Is the overlay using smoothed or raw joint positions?
- Is there any filtering that could hide valid joints?
- Does the overlay handle partial tracking gracefully?

### 5b. Improve overlay stability

- Ensure EMA smoothing is applied consistently
- Add joint confidence visualization (e.g., reduce opacity for low-confidence joints instead of hiding them)
- Add a visual indicator for "vertical displacement mode active" when angle tracking is degraded

---

## Phase 6: Cross-Exercise Generalization

### 6a. Apply improvements to other exercises

The vertical displacement signal works for any exercise with significant body movement:
- **Pushups**: Vertical displacement of shoulders/hips
- **Squats**: Vertical displacement of hips
- **Deadlifts**: Vertical displacement of hips and shoulders

For each exercise:
- Check if `lib/workouts/{exercise}.ts` has the same threshold issues as pullup
- Create at least 2 fixture scenarios (front-facing + back-facing)
- Verify rep detection accuracy

### 6b. Generalize the hybrid detector

Ensure the `HybridRepDetector` works with any workout definition, not just pullups. The reference joints and peak/valley direction should be configurable per exercise:
- Pullups: shoulders go UP on concentric
- Squats: hips go DOWN on concentric
- Pushups: shoulders go DOWN on concentric

---

## Metrics to Track (compare before/after for EVERY change)

| Metric | Description | Target |
|--------|-------------|--------|
| **Rep Accuracy** | abs(detected - expected) per fixture | 0 for all fixtures |
| **Rep Precision** | TP / (TP + FP) | > 0.95 |
| **Rep Recall** | TP / (TP + FN) | > 0.95 |
| **Back-Facing Parity** | back-turned accuracy / camera-facing accuracy | > 0.90 |
| **Partial Frame %** | Frames with partial tracking | Within expected range |
| **Cue Flip Rate** | Rate of cue state changes | < 15% raw, < 5% stabilized |
| **Mean FQI** | Average form quality score | Stable (no regression) |
| **Mean Frame Latency** | Processing time per frame | < 8ms p95 |
| **Tests Passing** | All unit + integration tests | 100% |

### How to run the full eval loop:

```bash
# 1. Regenerate fixtures (if corpus was modified)
bun run scripts/prepare-pullup-fixtures.ts

# 2. Run all form tracking tests
bun test tests/unit/tracking-quality/ tests/unit/fusion/ tests/unit/workout-runtime.test.ts tests/unit/fqi-calculator.test.ts tests/unit/pullup-false-rep-stability.test.ts

# 3. Run eval suite
bun run scripts/eval-pullup-tracking.ts --format=both

# 4. Run baseline comparison
bun run scripts/baseline-pullup-tracking.ts

# 5. Type check (ensure no regressions)
bun run check:types

# 6. Lint
bun run lint
```

---

## Parallelization Strategy — 5 Subagents

For each phase (after Phase 0 baseline), launch **5 subagents in parallel** with non-overlapping scopes. Each agent works in its own git worktree (`isolation: "worktree"`) to avoid conflicts. After all agents complete, review their branches, cherry-pick verified improvements, and run the full eval suite on the merged result.

### Agent Assignments

**Agent 1 — Fixture Architect** (Phase 1 scope)
```
Scope: lib/debug/pullup-fixture-corpus.ts, scripts/prepare-pullup-fixtures.ts, 
       scripts/eval-pullup-tracking.ts, scripts/baseline-pullup-tracking.ts,
       tests/fixtures/pullup-tracking/
Focus: Create the 6 new fixture scenarios (back-turned-multi, back-turned-no-deadhang,
       vertical-displacement, side-angle, fatigue-degradation, tracking-dropout-recovery).
       Update the eval script to compute rep precision/recall and load new fixtures.
       Regenerate all fixture JSON files. Run eval to establish new baselines.
Validation: bun run scripts/prepare-pullup-fixtures.ts && bun run scripts/eval-pullup-tracking.ts --format=both
DO NOT touch: lib/tracking-quality/, lib/workouts/, hooks/, app/
```

**Agent 2 — Vertical Displacement Engine** (Phase 2a-2c scope)
```
Scope: lib/tracking-quality/vertical-displacement.ts (NEW),
       lib/tracking-quality/hybrid-rep-detector.ts (NEW),
       tests/unit/tracking-quality/vertical-displacement.test.ts (NEW),
       tests/unit/tracking-quality/hybrid-rep-detector.test.ts (NEW)
Focus: Build the VerticalDisplacementTracker class and HybridRepDetector from scratch.
       Write comprehensive unit tests using synthetic sinusoidal data AND existing fixture
       format. The hybrid detector must accept both angle signals and 2D joint positions,
       blend them based on tracking quality, and output rep events.
       Design for testability — pure functions, no React dependencies, no side effects.
Validation: bun test tests/unit/tracking-quality/vertical-displacement.test.ts && 
            bun test tests/unit/tracking-quality/hybrid-rep-detector.test.ts &&
            bun run check:types
DO NOT touch: hooks/, app/, lib/workouts/, lib/fusion/, existing tracking-quality files
```

**Agent 3 — Tracking Quality Signals** (Phase 3 scope)
```
Scope: lib/tracking-quality/visibility.ts, lib/tracking-quality/scoring.ts,
       lib/tracking-quality/occlusion.ts, lib/tracking-quality/config.ts,
       tests/unit/tracking-quality/scoring.test.ts,
       tests/unit/tracking-quality/occlusion.test.ts
Focus: Add joint position stability scoring (frame-to-frame variance → synthetic confidence).
       Fix isJointVisible() to use stability-derived confidence instead of falling through
       to true for ARKit joints. Add overall tracking quality aggregation score per frame.
       Update existing tests, add new tests for stability scoring.
Validation: bun test tests/unit/tracking-quality/ && bun run check:types
DO NOT touch: lib/workouts/, hooks/, app/, lib/debug/, scripts/
```

**Agent 4 — Phase FSM & Workout Thresholds** (Phase 4 scope)
```
Scope: lib/workouts/pullup.ts, lib/workouts/pushup.ts, lib/workouts/squat.ts,
       lib/workouts/deadlift.ts, lib/workouts/benchpress.ts (and any other workout defs),
       lib/services/workout-runtime.ts,
       tests/unit/fusion/phase-fsm.test.ts, tests/unit/workout-runtime.test.ts
Focus: Audit ALL workout definitions for the same overly-strict threshold patterns found
       in pullup.ts (release/engage too close to dead position). Add FSM timeout recovery
       (max 5s in any phase before auto-reset without losing rep count). Add FSM edge case
       tests: stuck phases, tracking drops mid-transition, very slow reps, very fast reps.
       Document all thresholds found across exercises in a comment block.
Validation: bun test tests/unit/fusion/ tests/unit/workout-runtime.test.ts && bun run check:types
DO NOT touch: lib/tracking-quality/, hooks/, app/, lib/debug/, scripts/
```

**Agent 5 — Integration & Overlay** (Phase 2d + Phase 5 scope)
```
Scope: hooks/use-workout-controller.ts, app/(tabs)/scan-arkit.tsx,
       tests/unit/tracking-quality/rep-detector.test.ts
Focus: Wire the vertical displacement tracker and hybrid rep detector into the workout
       controller and scan-arkit UI. This agent depends on Agent 2's interfaces — use the
       type signatures from the Phase 2 spec above as the contract (import from
       lib/tracking-quality/vertical-displacement.ts and hybrid-rep-detector.ts).
       Audit skeleton overlay rendering: ensure EMA smoothing is consistent, add opacity
       scaling for low-confidence joints, add visual indicator when vertical displacement
       mode is active. Update rep-detector tests with new fixture scenarios.
Validation: bun run check:types && bun run lint
DO NOT touch: lib/debug/, scripts/, lib/workouts/, lib/tracking-quality/visibility.ts,
              lib/tracking-quality/scoring.ts
```

### Merge Strategy

After all 5 agents complete:

1. **Review each branch** — check that each agent stayed within its scope
2. **Merge in order**: Agent 1 (fixtures) → Agent 3 (quality signals) → Agent 4 (FSM) → Agent 2 (vertical engine) → Agent 5 (integration)
   - This order respects dependencies: fixtures first, then signals the engine depends on, then the engine, then integration
3. **Resolve conflicts** — Agent 5 may conflict with Agents 2-4 in imports; resolve by hand
4. **Run full eval suite** on merged result:
   ```bash
   bun run scripts/prepare-pullup-fixtures.ts
   bun test tests/unit/tracking-quality/ tests/unit/fusion/ tests/unit/workout-runtime.test.ts
   bun run scripts/eval-pullup-tracking.ts --format=both
   bun run check:types && bun run lint
   ```
5. **Compare metrics** against Phase 0 baseline — all targets in the metrics table must be met
6. **If any regression**, bisect by reverting agent branches one at a time to isolate the cause

### Relaunching Failed Agents

If any agent fails or produces no useful output:
1. Check the agent's output for the root cause (type errors, test failures, scope violations)
2. Narrow the scope — split the failed agent's work into a smaller task
3. Relaunch with the error context included in the prompt so it doesn't repeat the same mistake
4. If an agent dies 2x on the same task, flag it for manual review and move on

---

## Rules

1. **NEVER skip Phase 0.** Every run starts by capturing baseline metrics.
2. **ONE change at a time.** Make a single logical change, run eval, verify improvement, then commit before moving to the next.
3. **No regressions.** If a change improves back-facing but breaks front-facing, revert and find a different approach.
4. **Commit after each verified improvement.** Use format: `fix(tracking): description` with Touches/Outcome/Notes.
5. **If a phase produces no measurable improvement after 3 attempts, skip it** and move to the next phase. Document what was tried and why it didn't work.
6. **Do NOT modify test files to make tests pass.** Fix the source code.
7. **Do NOT add dependencies** without documenting why in the commit message.
8. **Do NOT modify `supabase/migrations/`, `ios/` native code, `android/` native code, or `.env` files.**
9. **Run `bun run lint` and `bun run check:types` before every commit.**
10. **Log all metrics to `logs/overnight/form-tracking-metrics.jsonl`** (append one JSON line per eval run with timestamp, phase, and all metrics).

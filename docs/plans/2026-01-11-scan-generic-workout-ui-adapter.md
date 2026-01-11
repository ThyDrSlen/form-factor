# Generic Scan Workout UI Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove workout-specific conditionals from `app/(tabs)/scan-arkit.tsx` by pushing UI/watch/upload/cue shaping into `lib/workouts/*` definitions.

**Architecture:** Extend `WorkoutDefinition` with an optional `ui` adapter that provides: icon name, realtime cue hook, watch metrics builder, upload metrics builder, and display metadata (primary/secondary metric keys + formatting). `scan-arkit.tsx` becomes a pure consumer of the active definition + adapter, so adding a new workout only requires adding a new workout file + registering it.

**Tech Stack:** TypeScript, Jest, `tsc` (`bun run check:types`), existing workout registry in `lib/workouts`.

---

### Task 1: Write failing typecheck/tests for the UI adapter contract

**Files:**
- Create: `tests/unit/workouts-ui-adapter.test.ts`

**Step 1: Write tests**

- Assert every `getWorkoutByMode(mode)` has `ui` defined with:
  - `iconName`
  - `primaryMetric`
  - `buildUploadMetrics()`
  - `buildWatchMetrics()`

**Step 2: Verify RED**

Run: `bun run check:types`
Expected: FAIL because `WorkoutDefinition` doesn’t have `ui` yet (and workouts don’t implement it).

---

### Task 2: Add UI adapter types to `WorkoutDefinition`

**Files:**
- Modify: `lib/types/workout-definitions.ts`

**Step 1: Add types**

- Add `WorkoutUiMetric` (`key`, `label`, `format`) and `WorkoutUiAdapter` (icon + builders + metrics).
- Add optional `ui?: WorkoutUiAdapter<TMetrics>` to `WorkoutDefinition`.

**Step 2: Verify RED moves**

Run: `bun run check:types`
Expected: still FAIL until workouts implement `ui`.

---

### Task 3: Implement `ui` adapter in each workout definition

**Files:**
- Modify: `lib/workouts/pullup.ts`
- Modify: `lib/workouts/pushup.ts`
- Modify: `lib/workouts/benchpress.ts`

**Step 1: Add `ui`**

- `iconName`: keep current UI behavior (`pullup` icon vs others).
- `buildUploadMetrics`: return flat keys used by uploads (`avgElbowDeg`, `avgShoulderDeg`, `hipDropRatio`, `headToHand`, …).
- `buildWatchMetrics`: return flat keys used by the watch (`avgElbowDeg`, `avgShoulderDeg`, `hipDropRatio`, `headToHand`).
- `primaryMetric`: `avgElbowDeg` in degrees for current workouts.
- `secondaryMetric`:
  - pullup/benchpress: `avgShoulderDeg` (deg)
  - pushup: `hipDropRatio` (%)
- `getRealtimeCues`: move existing pullup/pushup cue heuristics out of `scan-arkit.tsx`.

**Step 2: Verify GREEN**

Run: `bun run check:types`
Expected: PASS

---

### Task 4: Refactor `scan-arkit.tsx` to be adapter-driven

**Files:**
- Modify: `lib/workouts/index.ts`
- Modify: `app/(tabs)/scan-arkit.tsx`
- Modify: `lib/watch-connectivity/tracking-payload.ts`

**Step 1: Default mode**

- Export `DEFAULT_DETECTION_MODE` from `lib/workouts/index.ts`.
- Use that constant in `scan-arkit.tsx` state initialization (no hard-coded `'pullup'`).

**Step 2: Remove workout-specific branches**

- Replace `BaseUploadMetrics` mode union + switches with adapter calls:
  - Upload metrics: `{ mode, reps, ...activeWorkoutDef.ui.buildUploadMetrics(activeMetrics) }`
  - Watch metrics: `activeWorkoutDef.ui.buildWatchMetrics(activeMetrics)`
  - Feedback: `activeWorkoutDef.ui.getRealtimeCues?.(...)`
  - Icon: `activeWorkoutDef.ui.iconName`
- Use adapter metric metadata to render telemetry + preview labels/values.

**Step 3: Watch mode typing**

- Change `WatchTrackingMode` to `string` so adding new workouts doesn’t require touching watch types.

---

### Task 5: Verify + commit

**Step 1: Run tests**

Run: `bun run test`
Expected: PASS

Run: `bun run ci:local`
Expected: PASS

**Step 2: Commit**

- One atomic commit with conventional subject and Smart Commits body.


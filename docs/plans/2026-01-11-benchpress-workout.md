# Bench Press Workout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new `benchpress` workout that is selectable in the tracker, emits metrics to the watch mirror, and uploads clip metrics.

**Architecture:** Model `benchpress` after `pushup` as a registry-driven `WorkoutDefinition`. Keep workout-specific thresholds, phase logic, metrics, and fault heuristics inside `lib/workouts/benchpress.ts`, with only minimal UI mapping for upload/watch payloads.

**Tech Stack:** TypeScript, Expo Router UI, Jest, `tsc` typecheck, workout registry in `lib/workouts`.

---

### Task 1: Write failing tests for `benchpress` registry access

**Files:**
- Modify: `tests/unit/workouts-factory.test.ts`

**Step 1: Write the failing test**

- Add a test that calls `getWorkoutByMode('benchpress')` and asserts `id === 'benchpress'`.

**Step 2: Run typecheck to verify it fails**

Run: `bun run check:types`
Expected: FAIL because `'benchpress'` is not a valid `DetectionMode` yet.

---

### Task 2: Add the `benchpress` workout definition

**Files:**
- Create: `lib/workouts/benchpress.ts`

**Step 1: Implement phases/thresholds/metrics**

- Phases: `setup → lockout → lowering → bottom → press → lockout`.
- Rep boundary: starts at `lowering`, ends at `lockout`.
- Metrics: `avgElbow`, `avgShoulder`, `armsTracked`, `wristsTracked`.
- Faults: mirrored from `pushup` where applicable (`incomplete_lockout`, `shallow_depth`, `asymmetric_press`, `fast_rep`, `elbow_flare`).

**Step 2: Run typecheck**

Run: `bun run check:types`
Expected: still FAIL until registry is updated.

---

### Task 3: Register `benchpress` and update app/watch consumers

**Files:**
- Modify: `lib/workouts/index.ts`
- Modify: `lib/watch-connectivity/tracking-payload.ts`
- Modify: `app/(tabs)/scan-arkit.tsx`
- Modify: `lib/video-feed.ts`

**Step 1: Register workout**

- Add `benchpress` to `workoutsByMode` and `workoutRegistry`.
- Re-export `benchpressDefinition` and `BENCHPRESS_THRESHOLDS`.

**Step 2: Watch payload types**

- Extend `WatchTrackingMode` to include `'benchpress'`.

**Step 3: Upload/watch metrics mapping**

- Extend `BaseUploadMetrics` union to support `{ mode: 'benchpress'; ... }`.
- Switch `latestMetricsForUpload` and watch metrics mapping to handle `benchpress` explicitly.
- Update preview secondary metric labels/values for `benchpress`.

**Step 4: Run tests + typecheck**

Run: `bun run test`
Expected: PASS

Run: `bun run check:types`
Expected: PASS

---

### Task 4: Commit

**Step 1: Confirm clean staging**

Run: `git status -sb`

**Step 2: Commit**

Use conventional commit message, include Touches/Outcome/Notes body.


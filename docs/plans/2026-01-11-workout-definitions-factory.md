# Workout Definitions Factory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Centralize workout phase cues/labels and selection in `lib/workouts/`, and reduce `scan-arkit.tsx` hardcoded pullup/pushup branching.

**Architecture:** Add a typed workout factory (`getWorkoutByMode`) and small helpers in `lib/workouts/`, then refactor `app/(tabs)/scan-arkit.tsx` to consume the active workout definition for display name + static cues + thresholds access. Keep existing per-workout metrics state for now (avoid large UI refactor).

**Tech Stack:** TypeScript, React Native (Expo), Jest.

---

### Task 1: Add typed workout factory + helpers

**Files:**
- Modify: `lib/workouts/index.ts`
- Create: `lib/workouts/helpers.ts`

**Step 1: Write the failing test**

Create `tests/unit/workouts-factory.test.ts`:

```ts
import { getWorkoutByMode, getPhaseStaticCue } from '@/lib/workouts';

test('getWorkoutByMode returns pullup definition', () => {
  const def = getWorkoutByMode('pullup');
  expect(def.id).toBe('pullup');
  expect(def.displayName).toBeTruthy();
});

test('getPhaseStaticCue returns a cue for initial phase', () => {
  const def = getWorkoutByMode('pushup');
  const cue = getPhaseStaticCue(def, def.initialPhase);
  expect(typeof cue).toBe('string');
  expect(cue.length).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/workouts-factory.test.ts`  
Expected: FAIL (exports not found).

**Step 3: Write minimal implementation**

- In `lib/workouts/index.ts`, add `getWorkoutByMode` overloads for `'pullup' | 'pushup'`.
- Create `lib/workouts/helpers.ts` exporting `getPhaseStaticCue(def, phaseId)`.
- Re-export `getWorkoutByMode` and `getPhaseStaticCue` from `lib/workouts/index.ts`.

**Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/workouts-factory.test.ts`  
Expected: PASS.

---

### Task 2: Refactor `scan-arkit.tsx` to use active workout definition for prompts/labels/thresholds

**Files:**
- Modify: `app/(tabs)/scan-arkit.tsx`

**Step 1: Add active definition memo**

- Add `const activeWorkoutDef = useMemo(() => getWorkoutByMode(detectionMode), [detectionMode]);`
- Replace UI labels like “Pull-Up” / “Push-Up” with `activeWorkoutDef.displayName`.

**Step 2: Replace hardcoded phase cue maps**

- Remove local `phasePrompts` objects.
- Use `getPhaseStaticCue(activeWorkoutDef, currentPhase)` where `currentPhase` is `pullUpPhase` or `pushUpPhase`.

**Step 3: Replace remaining threshold lookups**

- Remove imports of `PULLUP_THRESHOLDS` / `PUSHUP_THRESHOLDS` from `scan-arkit.tsx`.
- Access threshold values via `activeWorkoutDef.thresholds` (casting per workout where needed).

**Step 4: Run typecheck**

Run: `bun run check:types`  
Expected: PASS.

---

### Task 3: Document how to add a new workout definition

**Files:**
- Create: `lib/workouts/README.md`

**Step 1: Write documentation**

Include:
- What a `WorkoutDefinition` contains (phases, thresholds, faults, scoring metrics).
- Where to place new workouts (`lib/workouts/<id>.ts`).
- How to register in `lib/workouts/index.ts`.
- What `calculateMetrics` and `getNextPhase` should do.

---

### Task 4: Verification

**Step 1: Run unit test**

Run: `bun run test tests/unit/workouts-factory.test.ts`

**Step 2: Run lint + typecheck**

Run: `bun run ci:local`


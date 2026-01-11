# Generic Phase + Rep State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove pullup/pushup-specific phase+rep state from `scan-arkit.tsx` and make the tracking loop run off the active `WorkoutDefinition`.

**Architecture:** Replace the parallel state machines (`pullUpPhase`/`pushUpPhase`, `repCount`/`pushUpReps`, etc.) with a single `activePhase`, `activeMetrics`, and `repCount` that are reset on detection-mode change. Keep upload/preview metric shaping as a small per-workout mapping layer for now.

**Tech Stack:** TypeScript, React Native (Expo), Jest.

---

### Task 1: Make `getPhaseStaticCue` usable with dynamic phase IDs

**Files:**
- Modify: `lib/workouts/helpers.ts`

**Step 1: Write the failing test**

Create `tests/unit/workouts-phase-cues.test.ts`:

```ts
import { getWorkoutByMode, getPhaseStaticCue } from '@/lib/workouts';

test('getPhaseStaticCue works with dynamic phase id string', () => {
  const def = getWorkoutByMode('pullup');
  const phaseId: string = def.initialPhase;
  expect(getPhaseStaticCue(def, phaseId)).toBeTruthy();
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/workouts-phase-cues.test.ts`  
Expected: FAIL (type error or runtime mismatch depending on implementation).

**Step 3: Implement overload**

Add an overload to `getPhaseStaticCue` that accepts `(definition: WorkoutDefinition, phaseId: string)`.

**Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/workouts-phase-cues.test.ts`  
Expected: PASS.

---

### Task 2: Collapse `scan-arkit.tsx` to a single phase + rep counter

**Files:**
- Modify: `app/(tabs)/scan-arkit.tsx`

**Step 1: Replace parallel state with generic state**

Remove:
- `pullUpPhase` / `pushUpPhase`
- `pushUpReps`
- `pullUpMetrics` / `pushUpMetrics` (and their refs)
- `pushUpStateRef`
- `lastPushUpRepRef`

Add:
- `const [activePhase, setActivePhase] = useState<string>(...)`
- `const activePhaseRef = useRef<string>(...)`
- `const [activeMetrics, setActiveMetrics] = useState<WorkoutMetrics | null>(null)`
- Keep `repCount` only.

**Step 2: Make `updateWorkoutCycle` mode-agnostic**

Rewrite `updateWorkoutCycle` to use `activePhaseRef` + `repCount` and call `completeRepTracking(workoutDef.id, ...)`.

**Step 3: Update form feedback + telemetry**

- Phase label uses `activeWorkoutDef.phases` displayName lookup for `activePhase`.
- `primaryCue` uses `getPhaseStaticCue(activeWorkoutDef, activePhase)`.
- Keep any extra hinting as minimal per-workout mapping if needed.

**Step 4: Run typecheck**

Run: `bun run check:types`  
Expected: PASS.

---

### Task 3: Verification

**Step 1: Run unit tests**

Run: `bun run test`

**Step 2: Run lint + typecheck**

Run: `bun run ci:local`


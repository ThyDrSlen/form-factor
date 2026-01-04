# Rep Index Alignment and Workout Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align pose frame rep numbering with logged rep indices and remove duplicated per-exercise runtime logic by driving rep state from WorkoutDefinition, while generalizing FQI scoring via per-workout metric extractors.

**Architecture:** Add a small rep-index tracker and wire it into scan-arkit pose logging. Replace exercise-specific FSM blocks with a generic per-frame runner using WorkoutDefinition.calculateMetrics, getNextPhase, and repBoundary. Extend WorkoutDefinition with scoringMetrics extractors and update FQI to use them.

**Tech Stack:** TypeScript, React Native (Expo), Jest, Supabase logging, existing WorkoutDefinition registry.

---

### Task 1: Add a rep index tracker utility

**Files:**
- Create: `lib/services/rep-index-tracker.ts`
- Create: `tests/rep-index-tracker.test.ts`

**Step 1: Write the failing test**

```ts
import { RepIndexTracker } from '@/lib/services/rep-index-tracker';

test('RepIndexTracker assigns 1-indexed active rep and clears on end', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.current()).toBeNull();
  expect(tracker.startRep(0)).toBe(1);
  expect(tracker.current()).toBe(1);
  expect(tracker.endRep()).toBe(1);
  expect(tracker.current()).toBeNull();
});

test('RepIndexTracker increments based on completed count', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.startRep(5)).toBe(6);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/rep-index-tracker.test.ts`
Expected: FAIL with module not found or missing export.

**Step 3: Write minimal implementation**

```ts
export class RepIndexTracker {
  private active: number | null = null;

  current(): number | null {
    return this.active;
  }

  startRep(completedCount: number): number {
    this.active = completedCount + 1;
    return this.active;
  }

  endRep(): number | null {
    const active = this.active;
    this.active = null;
    return active;
  }

  reset(): void {
    this.active = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test -- tests/rep-index-tracker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/services/rep-index-tracker.ts tests/rep-index-tracker.test.ts

git commit -m "feat: add rep index tracker utility"
```

---

### Task 2: Wire rep index tracker and NULL rep_number into pose logging

**Files:**
- Modify: `app/(tabs)/scan-arkit.tsx`
- Modify: `lib/services/pose-logger.ts`
- Modify: `lib/types/telemetry.ts`

**Step 1: Write failing test**

Add a test that `pose-logger` accepts `repNumber: null` without type errors by importing the type:

```ts
import type { PoseSample } from '@/lib/services/pose-logger';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

const angles: JointAngles = {
  leftElbow: 90, rightElbow: 90,
  leftShoulder: 90, rightShoulder: 90,
  leftKnee: 90, rightKnee: 90,
  leftHip: 90, rightHip: 90,
};

const sample: PoseSample = {
  sessionId: 's',
  frameTimestamp: 1,
  exerciseMode: 'pullup',
  phase: 'hang',
  repNumber: null,
  angles,
};

expect(sample.repNumber).toBeNull();
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/rep-index-tracker.test.ts`
Expected: FAIL because PoseSample.repNumber is `number`.

**Step 3: Implement minimal code changes**

- `lib/services/pose-logger.ts`
  - Change `repNumber: number;` to `repNumber: number | null;`
  - Insert `rep_number: sample.repNumber ?? null` in Supabase insert payload.
- `lib/types/telemetry.ts`
  - Change `FrameSample.repNumber?: number` to `repNumber?: number | null`.
- `app/(tabs)/scan-arkit.tsx`
  - Instantiate `RepIndexTracker` (e.g. `const repIndexTrackerRef = useRef(new RepIndexTracker())`).
  - On rep start (right before `startRepTracking` call sites), set `repIndexTrackerRef.current.startRep(completedCount)` and pass that index into `startRepTracking` or store in a ref.
  - In `logPoseSample`, set `repNumber: repIndexTrackerRef.current.current()` so non-rep frames log `null`.
  - On rep completion and on rep abort paths (pose lost, detection mode switch, stopTracking), call `repIndexTrackerRef.current.endRep()` or `reset()`.
  - Use phase refs for logging to avoid React state lag (`phaseRef.current` / `pushUpStateRef.current`).

**Step 4: Run tests**

Run: `bun run test -- tests/rep-index-tracker.test.ts`
Expected: PASS

**Step 5: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add app/(tabs)/scan-arkit.tsx lib/services/pose-logger.ts lib/types/telemetry.ts

git commit -m "fix: align pose rep_number with active rep index"
```

---

### Task 3: Replace duplicated per-exercise FSM with generic runtime

**Files:**
- Create: `lib/services/workout-runtime.ts`
- Create: `tests/workout-runtime.test.ts`
- Modify: `app/(tabs)/scan-arkit.tsx`

**Step 1: Write the failing test**

```ts
import { shouldStartRep, shouldEndRep } from '@/lib/services/workout-runtime';
import type { RepBoundary } from '@/lib/types/workout-definitions';

test('rep starts on transition into startPhase', () => {
  const boundary: RepBoundary<'a' | 'b'> = { startPhase: 'a', endPhase: 'b', minDurationMs: 400 };
  expect(shouldStartRep(boundary, 'b', 'a')).toBe(true);
  expect(shouldStartRep(boundary, 'a', 'a')).toBe(false);
});

test('rep ends on transition into endPhase after debounce', () => {
  const boundary: RepBoundary<'a' | 'b'> = { startPhase: 'a', endPhase: 'b', minDurationMs: 400 };
  expect(shouldEndRep(boundary, 'a', 'b', true, 1000, 0)).toBe(true);
  expect(shouldEndRep(boundary, 'a', 'b', true, 200, 0)).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/workout-runtime.test.ts`
Expected: FAIL with missing module.

**Step 3: Write minimal implementation**

```ts
export function shouldStartRep<T extends string>(boundary: RepBoundary<T>, prev: T, next: T): boolean {
  return prev !== boundary.startPhase && next === boundary.startPhase;
}

export function shouldEndRep<T extends string>(
  boundary: RepBoundary<T>,
  prev: T,
  next: T,
  repActive: boolean,
  nowMs: number,
  repStartMs: number
): boolean {
  if (!repActive) return false;
  if (prev === boundary.endPhase || next !== boundary.endPhase) return false;
  return nowMs - repStartMs >= boundary.minDurationMs;
}
```

**Step 4: Integrate in `scan-arkit.tsx`**

- Replace `updatePullUpCycle` and `updatePushUpCycle` with a single `updateWorkoutCycle` that:
  - Looks up `def = getWorkoutById(detectionMode)`
  - Computes `metrics = def.calculateMetrics(angles, jointsMap)`
  - Computes `nextPhase = def.getNextPhase(currentPhase, angles, metrics)`
  - Updates phase refs/state if changed
  - Starts a rep on `shouldStartRep(def.repBoundary, prevPhase, nextPhase)`
  - Ends a rep on `shouldEndRep(def.repBoundary, prevPhase, nextPhase, repActive, now, repStartTsRef.current)`
- Remove hard-coded debounce constants and thresholds from `scan-arkit.tsx`.

**Step 5: Run tests and lint**

Run: `bun run test -- tests/workout-runtime.test.ts`
Expected: PASS

Run: `bun run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add lib/services/workout-runtime.ts tests/workout-runtime.test.ts app/(tabs)/scan-arkit.tsx

git commit -m "refactor: drive rep FSM from workout definitions"
```

---

### Task 4: Generalize FQI scoring via scoringMetrics

**Files:**
- Modify: `lib/types/workout-definitions.ts`
- Modify: `lib/services/fqi-calculator.ts`
- Modify: `lib/workouts/pullup.ts`
- Modify: `lib/workouts/pushup.ts`
- Create: `tests/fqi-calculator.test.ts`

**Step 1: Write the failing test**

```ts
import { calculateFqi } from '@/lib/services/fqi-calculator';
import type { WorkoutDefinition } from '@/lib/types/workout-definitions';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

const angles: JointAngles = {
  leftElbow: 170, rightElbow: 170,
  leftShoulder: 90, rightShoulder: 90,
  leftKnee: 170, rightKnee: 170,
  leftHip: 170, rightHip: 170,
};

const def: WorkoutDefinition = {
  id: 'test',
  displayName: 'Test',
  description: '',
  category: 'upper_body',
  difficulty: 'beginner',
  phases: [],
  initialPhase: 'idle',
  repBoundary: { startPhase: 'a', endPhase: 'b', minDurationMs: 0 },
  thresholds: {},
  angleRanges: { elbow: { min: 160, max: 175, optimal: 170, tolerance: 5 } },
  faults: [],
  fqiWeights: { rom: 1, depth: 0, faults: 0 },
  calculateMetrics: () => ({ armsTracked: true }),
  getNextPhase: (p) => p,
  scoringMetrics: [
    {
      id: 'elbow',
      extract: (rep, side) => ({
        start: rep.start[side === 'left' ? 'leftElbow' : 'rightElbow'],
        end: rep.end[side === 'left' ? 'leftElbow' : 'rightElbow'],
        min: rep.min[side === 'left' ? 'leftElbow' : 'rightElbow'],
        max: rep.max[side === 'left' ? 'leftElbow' : 'rightElbow'],
      }),
    },
  ],
};

test('FQI uses scoringMetrics extractors', () => {
  const result = calculateFqi({ start: angles, end: angles, min: angles, max: angles }, 1000, 1, def);
  expect(result.romScore).toBe(100);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/fqi-calculator.test.ts`
Expected: FAIL because scoringMetrics is not supported.

**Step 3: Implement minimal code changes**

- `lib/types/workout-definitions.ts`
  - Add `scoringMetrics?: Array<{ id: string; extract: (repAngles: RepAngles, side: 'left' | 'right') => { start: number; end: number; min: number; max: number } }>`
- `lib/services/fqi-calculator.ts`
  - If `workoutDef.scoringMetrics` exists, use it to compute ROM and depth instead of hard-coded elbow/shoulder/knee/hip logic.
  - Fallback to existing behavior if `scoringMetrics` is undefined.
- `lib/workouts/pullup.ts` and `lib/workouts/pushup.ts`
  - Add `scoringMetrics` entries for elbow (and hip for pushup if used in depth) using extractors.

**Step 4: Run tests and lint**

Run: `bun run test -- tests/fqi-calculator.test.ts`
Expected: PASS

Run: `bun run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/types/workout-definitions.ts lib/services/fqi-calculator.ts lib/workouts/pullup.ts lib/workouts/pushup.ts tests/fqi-calculator.test.ts

git commit -m "refactor: generalize FQI scoring via scoring metrics"
```

---

## Test plan (final)
- `bun run test -- tests/rep-index-tracker.test.ts`
- `bun run test -- tests/workout-runtime.test.ts`
- `bun run test -- tests/fqi-calculator.test.ts`
- `bun run lint`

## Notes
- The worktree is at `.worktrees/fix/rep-index-alignment`.
- Rep indices outside an active rep are logged as `NULL` in `pose_samples.rep_number`.
- Joining frames to reps should use `(session_id, rep_number == rep_index)`.


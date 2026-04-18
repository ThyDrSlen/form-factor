# Personalized Cue Report

Deterministic output of `staticPersonalizedCueRunner` across canonical (exercise, fault, history) cases. Regenerate with `bun scripts/personalized-cue-report.ts`.

- Total cases: **13**
- Source: static (glossary lookup + history heuristic)

## First-timer

### Squat — shallow depth

- **Exercise × fault:** `squat` · `shallow_depth`
- **History:** none

> You are not descending low enough in the squat.

- **References history:** no
- **Source:** `static`

### Squat — knees caving

- **Exercise × fault:** `squat` · `knee_valgus`
- **History:** none

> Your knees track inward toward each other during the descent or ascent.

- **References history:** no
- **Source:** `static`

### Push-up — hip sag

- **Exercise × fault:** `pushup` · `hip_sag`
- **History:** none

> Your hips drop toward the floor during the rep.

- **References history:** no
- **Source:** `static`

### Deadlift — rounded back

- **Exercise × fault:** `deadlift` · `rounded_back`
- **History:** none

> Your upper or lower back rounds under the load.

- **References history:** no
- **Source:** `static`

### Bench press — elbow flare

- **Exercise × fault:** `benchpress` · `elbow_flare`
- **History:** none

> Elbows flare wide (close to 90°) during the press.

- **References history:** no
- **Source:** `static`

### Explicit zero occurrences

- **Exercise × fault:** `squat` · `shallow_depth`
- **History:** 0 occurrences, last seen 0 sessions ago

> You are not descending low enough in the squat.

- **References history:** no
- **Source:** `static`

## Repeat offender (prepends "third session")

### Squat shallow depth — 4 recent sessions

- **Exercise × fault:** `squat` · `shallow_depth`
- **History:** 4 occurrences, last seen 0 sessions ago

> Third session in a row on this one — You are not descending low enough in the squat.

- **References history:** yes
- **Source:** `static`

### Deadlift rounded back — 6 recent sessions

- **Exercise × fault:** `deadlift` · `rounded_back`
- **History:** 6 occurrences, last seen 1 session ago

> Third session in a row on this one — Your upper or lower back rounds under the load.

- **References history:** yes
- **Source:** `static`

## Stale recurrence (no prefix)

### Squat shallow depth — 4 occurrences but 5 sessions ago

- **Exercise × fault:** `squat` · `shallow_depth`
- **History:** 4 occurrences, last seen 5 sessions ago

> Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets.

- **References history:** no
- **Source:** `static`

## Mid-tier (uses fixTip[0])

### Squat shallow depth — 1 occurrence

- **Exercise × fault:** `squat` · `shallow_depth`
- **History:** 1 occurrence, last seen 0 sessions ago

> Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets.

- **References history:** no
- **Source:** `static`

### Bench press elbow flare — 2 occurrences

- **Exercise × fault:** `benchpress` · `elbow_flare`
- **History:** 2 occurrences, last seen 0 sessions ago

> Cue: 'bend the bar apart' to activate lats and tuck elbows.

- **References history:** no
- **Source:** `static`

## Fallback

### Unknown fault id

- **Exercise × fault:** `squat` · `nonexistent_fault`
- **History:** none

> Nothing more to add.

- **References history:** no
- **Source:** `static`

### Unknown exercise

- **Exercise × fault:** `nonexistent_exercise` · `shallow_depth`
- **History:** none

> Nothing more to add.

- **References history:** no
- **Source:** `static`

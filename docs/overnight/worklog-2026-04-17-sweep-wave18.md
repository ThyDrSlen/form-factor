# Sweep Worklog — Wave-18 (2026-04-17)

**Directive.** Continue improving form-tracking UX. Progress Gemma by Google.
Prefer **large-scoped PRs** over many tiny ones. Commits stay atomic.

## Theme

"Form-tracking stress hardening — human validation guard + subject-identity
tracker + stress fixture corpus"

Closes #451.

## Why this theme

Two silent-failure classes that current pipeline can't detect:

1. **Skeleton on inanimate object.** ARKit happily places a skeleton on a
   yoga mat, gym bag, or hanging towel. No downstream guard notices; rep
   counter and FQI score run on garbage. Users have reported phantom reps
   when phone is propped on a mat mid-set.

2. **Subject-switch teleport.** Second person walks between user and camera
   and ARKit silently swaps which body it tracks. No body-anchor ID in
   `ARBodyAnchor`, so the only signal is anthropometric discontinuity.
   Current pipeline treats the switch as valid data and contaminates the
   rep timeline.

Wave-18 ships **both guards** plus a **9-scenario stress fixture corpus**
that replays adversarial poses through the pipeline and asserts the guards
reject them. All guards are pure TS with no native or ARKit dependency —
they operate on the 2D joint stream already exposed by the ARKit body
tracker module.

## Outcome

- **PR #TBD** (wave-18) opened against main, atomic commits, 92 tests
  passing across the tracking-quality suite (51 new across 4 new suites,
  zero regressions on the existing 5 pullup fixture tests).
- Single large-scoped PR.
- No migrations, no native code, no new dependencies.
- Zero lint warnings on new files.
- Eval script for replaying real Supabase pose-sample data through both
  guards — ready to run once pose_samples.joint_positions backfill lands.

## What ships

### Guards

| Guard | File | Purpose |
|------|------|---------|
| `HumanValidationGuard` | `lib/tracking-quality/human-validation.ts` | Rejects skeletons on inanimate objects via 4 weighted checks (min joints, anatomy, proportions, motion). Per-frame, O(joints). |
| `SubjectIdentityTracker` | `lib/tracking-quality/subject-identity.ts` | Detects subject-switch via centroid teleport + anthropometric signature deviation. Auto-recalibrates after 5s persistent switch (handing phone to friend). |

### Fixture corpus

Nine adversarial traces at 30 fps, generated deterministically from seeded
PRNGs so they're stable across CI runs:

1. `skeleton-on-object` — near-zero motion, valid anatomy
2. `skeleton-on-object-crucifix` — arms out, bag shape
3. `partial-body-upper-only` — lower body not tracked
4. `extreme-oblique-side` — shoulders nearly collinear
5. `tracking-flicker` — isTracked toggles every 2-3 frames
6. `crowd-noise` — low-confidence jittery frames
7. `subject-switch-and-return` — teleport mid-session
8. `person-walkthrough-brief` — 1s stranger, original returns
9. `person-walkthrough-steals` — stranger takes over (auto-recalibrate path)

### Test suites

- `tests/unit/tracking-quality/human-validation.test.ts` — unit coverage of
  all 4 checks + confidence weighting + rejection reasons.
- `tests/unit/tracking-quality/subject-identity.test.ts` — calibration, switch
  detection, recovery, auto-recalibrate, reset.
- `tests/unit/tracking-quality/stress-scenarios.test.ts` — replays all 9
  adversarial fixtures and asserts correct guard behaviour.
- `tests/unit/tracking-quality/guard-regression.test.ts` — regression check
  that guards pass >90% of frames on the 5 known-good pullup fixtures on
  main (camera-facing, back-turned, bounce-noise, occlusion-brief,
  occlusion-long).

### Tooling

- `scripts/prepare-stress-fixtures.ts` — regenerate the fixture corpus from
  the builder (`bunx tsx scripts/prepare-stress-fixtures.ts`).
- `scripts/eval-guards-from-supabase.ts` — pipe real pose_samples rows
  through both guards to tune thresholds against production data.

## Deferred

- Wiring the guards into `hooks/use-workout-controller.ts` / the session
  runner — left for a follow-up so the pure algorithmic layer can be
  reviewed in isolation.
- UI treatment for `switchDetected` — paired with #445 (resilience +
  AR overlay depth) and #427 (session binding/resume) which already plan
  subject-ID UX.

## Not touched in this PR

- `supabase/migrations/` — no schema changes.
- `ios/`, `android/`, `modules/*/ios/`, `modules/*/android/` — no native code.
- No new dependencies.

## Files added on this branch

```
lib/tracking-quality/human-validation.ts
lib/tracking-quality/subject-identity.ts
lib/debug/stress-fixture-corpus.ts
scripts/eval-guards-from-supabase.ts
scripts/prepare-stress-fixtures.ts
tests/fixtures/stress-tracking/crowd-noise.json
tests/fixtures/stress-tracking/extreme-oblique-side.json
tests/fixtures/stress-tracking/partial-body-upper-only.json
tests/fixtures/stress-tracking/person-walkthrough-brief.json
tests/fixtures/stress-tracking/person-walkthrough-steals.json
tests/fixtures/stress-tracking/skeleton-on-object-crucifix.json
tests/fixtures/stress-tracking/skeleton-on-object.json
tests/fixtures/stress-tracking/subject-switch-and-return.json
tests/fixtures/stress-tracking/tracking-flicker.json
tests/unit/tracking-quality/guard-regression.test.ts
tests/unit/tracking-quality/human-validation.test.ts
tests/unit/tracking-quality/stress-scenarios.test.ts
tests/unit/tracking-quality/subject-identity.test.ts
docs/overnight/worklog-2026-04-17-sweep-wave18.md
```

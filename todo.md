# TODO

## In Progress: Form Tracking Data Pipeline

### Completed
- [x] Delete dead code (`lib/types/form-feedback.ts`)
- [x] Create workout definition types (`lib/types/workout-definitions.ts`)
- [x] Create pull-up workout definition (`lib/workouts/pullup.ts`)
- [x] Create push-up workout definition (`lib/workouts/pushup.ts`)
- [x] Create workout registry (`lib/workouts/index.ts`)
- [x] Create FQI calculator service (`lib/services/fqi-calculator.ts`)
- [x] Add rep tracking refs to scan-arkit.tsx
- [x] Wire `logRep()` into rep completion flow

### Remaining: Workout Architecture
- [ ] Refactor scan-arkit.tsx to use workout definitions from `lib/workouts/`
- [ ] Replace hardcoded thresholds with values from workout definitions
- [ ] Create workout factory pattern to replace if/else workout selection
- [ ] Document workout definition structure for contributors

### Next Workouts to Implement
- [ ] RDLs
- [ ] Chinups
- [ ] Deadlift
- [ ] Dead Hang
- [ ] Squats
- [ ] Benchpress
- [ ] Farmers Walk

---

## Code Quality

### Utility Consolidation
- [ ] Consolidate `ensureUserId()` into single auth utility (currently duplicated in: consent-service.ts, cue-logger.ts, pose-logger.ts, rep-logger.ts, video-service.ts)
- [ ] Audit platform-utils usage across codebase (forgot-password.tsx, sign-in.tsx, sign-up.tsx, add-food.tsx, notifications.tsx, DashboardHealth.tsx)
- [ ] Ensure all utility functions are reused (no redeclaration without documented reason)

### Code Cleanup
- [ ] Review scan-arkit.tsx for remaining TODOs
- [ ] Determine what proprietary code (heuristics, joint angle modeling) should not be in public repo

---

## Release Engineering

- [ ] If disabling New Arch fixes the TestFlight crash, set `EXPO_USE_NEW_ARCH=0` in `eas.json` preview/production and CI envs (GitHub runners)

---

## Checks for Understanding

- [ ] Will skeleton overlay adjust to size of the user?
- [ ] Why does React need separate toast import for Android (line 2)?
- [ ] If front camera doesn't support form tracking, should we disable it?
- [ ] Are we using 2D or 3D tracking currently?
- [ ] How do goals/objectives influence heuristics (explosive athletes vs. lifters, 1RM edge case)?
- [ ] Should logging be more centralized?
- [ ] Should scan even be displayed on web? (probably not)
- [ ] What is `Haptics.impactAsync()`?

### Cue System Clarification
- [ ] Standardize terminology: "cues" not "prompts" to avoid confusion with coach prompts
- [ ] Document two cue types:
  - Static cues: General phase-based advice (on-device, low latency)
  - Dynamic cues: Fault-driven corrections from FF brain (may have server latency)

---

## Features (Later)

### Social
- [ ] Followers + following with approval system
- [ ] Privacy settings: public vs. followers-only workout stats
- [ ] Fix comments + likes functionality

### UI Enhancements
- [ ] Zoom slider (0.5x-3x) on left side, opacity fades after 2s of no interaction

---

## Vision: FF Brain

Form tracking is the bread and butter of the app. Long-term goals:

- [ ] Auto-detect workout type based on joint angles and movement patterns (after ~2 reps)
- [ ] Auto-track reps, sets, weight, and all associated metrics
- [ ] Explore mask of user + skeleton overlay as ML input
- [ ] Understand how bodies move in accordance with workouts

---

## Notes

### Workout Form Tracker Structure
Each workout definition consists of:
- **Phases**: e.g., `'idle' | 'hang' | 'pull' | 'top'`
- **Metrics**: e.g., reps, avgElbowDeg, avgShoulder, headToHand (pullup), hipDropRatio (pushup)
- **Thresholds**: Angle values for phase transitions
- **Faults**: Detectable form issues with dynamic cues
- **FQI Weights**: ROM, depth, fault contributions to form quality score

### Architecture Decision
Each workout should have its own file in `lib/workouts/` so that:
- Anyone working on new workouts can understand correct/incorrect form from the file itself
- Joint angle logic and math is self-contained per workout
- Avoids if/else chains like `detectionMode === 'pullup' ? ... : ...` that don't scale

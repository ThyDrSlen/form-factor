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
- [x] Refactor scan-arkit.tsx to use workout definitions from `lib/workouts/`
- [x] Replace hardcoded thresholds with values from workout definitions
- [x] Create workout factory pattern to replace if/else workout selection (`getWorkoutByMode()`)
- [x] Document workout definition structure for contributors (see `lib/workouts/README.md`)

### Next Workouts to Implement
- [x] RDLs (`lib/workouts/rdl.ts`)
- [ ] Chinups
- [x] Deadlift (`lib/workouts/deadlift.ts`)
- [ ] Dead Hang
- [x] Squats (`lib/workouts/squat.ts`)
- [x] Benchpress (`lib/workouts/benchpress.ts`)
- [x] Farmers Walk (`lib/workouts/farmers-walk.ts`)

---

#Bugs

At end of "Record Set App crashes" 

### Record Set App crashes — quick diagnosis + plan (no code changes yet)

**What happens in code**
- `Record Set` toggles `startRecordingVideo()` / `stopRecordingVideo()` in `app/(tabs)/scan-arkit.tsx`.
- `startRecordingVideo()` calls native `BodyTracker.startRecording()` (ARKit).
- `stopRecordingVideo()` calls native `BodyTracker.stopRecording()` and then:
  - `saveRecordingToCameraRoll()` (MediaLibrary)
  - `uploadRecordedVideo()` → `uploadWorkoutVideo()` in `lib/services/video-service.ts` (base64 read + Supabase upload)

**Most likely crash vectors (ranked)**
1) **Memory pressure / OOM** during `FileSystem.readAsStringAsync(..., base64)` for large `.mov` files. iOS can kill the app without JS errors.
2) **Native recording edge case**: `AVAssetWriter`/pixel buffer adaptor mismatch or session interruption during recording (start/stop while ARSession pauses).
3) **Stop tracking while recording**: `stopTracking()` calls `BodyTracker.stopRecording()` while ARSession delegate still appending frames → potential race.
4) **No-frame recording**: stop immediately after start; native path resolves but `finishWriting` returns failure (should surface error but could crash if writer state is bad).
5) **File type mismatch**: recorded `.mov` uploaded as `.mp4` (not a crash, but can trigger downstream errors).

**Plan to isolate**
1) **Repro + logs**: Reproduce on device with Xcode console / device logs. Capture: device model, iOS version, whether crash happens on Start vs Stop.
2) **Memory profile**: Use Instruments (Allocations + Memory graph) during stop → upload to confirm OOM spike.
3) **Binary isolate**:
   - First: bypass upload step (temporarily) to see if crash disappears.
   - Second: bypass MediaLibrary save step.
4) **Native recorder health**: add targeted native logs around `startRecording`, `appendFrame`, `stopRecording`, and writer status; confirm frames were written before stop.
5) **File sanity**: inspect output file size/duration immediately after stop; ensure it exists and is non‑zero.

**Likely fixes (depending on results)**
- If memory: replace base64 upload with streaming/file upload (`FileSystem.uploadAsync`), or compress/shorten clips before upload.
- If native race: ensure `stopRecording` finishes before pausing session; block stopTracking while recording; handle session interruptions.
- If no-frame: delay enabling “Stop” for N frames or validate `hasWrittenFrame` before stop.
- If file type mismatch: upload as `.mov` or transcode to `.mp4` explicitly.
- **UX change**: don’t auto‑upload on stop. Save locally, show preview, then user chooses “Save/Upload” vs “Discard.” (Also avoids immediate memory spike.)

**Preview-first flow (✅ IMPLEMENTED)**
- On Stop: finalize recording → save local file URI → open preview modal/screen.
- Preview UI: video player, duration, size, metrics summary.
- CTAs: `Publish + Save`, `Save only`, `Discard`.
- Background: only upload after explicit user action; show progress; allow cancel.

**Acceptance criteria** (verified in code)
- ✅ Stopping a recording never triggers upload automatically.
- ✅ Preview opens after stop (with finalizing state).
- ✅ "Discard" removes the local file and returns to tracking screen.
- ✅ "Save Only" stores to camera roll (if permission) without upload.
- ✅ "Publish + Save" uploads successfully with progress and clear failure messaging.

**Still needs testing**: The crash may still occur during the finalization/stop step itself (memory pressure during `stopRecording`). The preview-first flow mitigates the upload-side memory issues but native recorder crashes still need investigation.

**Logs in terminal don't include timestamps** — Note: `scan-arkit.tsx` has a `logWithTs()` helper but it's only used in a few places. Consider using it consistently or adding timestamps to all debug logs.



## Code Quality

### Utility Consolidation
- [x] Consolidate `ensureUserId()` into single auth utility → moved to `lib/auth-utils.ts`
- [ ] Audit platform-utils usage across codebase (forgot-password.tsx, sign-in.tsx, sign-up.tsx, add-food.tsx, notifications.tsx, DashboardHealth.tsx)
- [ ] Ensure all utility functions are reused (no redeclaration without documented reason)

### Code Cleanup
- [x] Review scan-arkit.tsx for remaining TODOs (none found)
- [ ] Determine what proprietary code (heuristics, joint angle modeling) should not be in public repo

---

## Release Engineering

- [ ] TestFlight crash triage (New Arch must stay ON for Reanimated): avoid doing `Object.keys(...)` on JSI/TurboModule proxies at module import time; lazy-load heavy native modules where possible

---

## Checks for Understanding

- [ ] Will skeleton overlay adjust to size of the user?
- [ ] Why does React need separate toast import for Android (line 2)?
- [x] If front camera doesn't support form tracking, should we disable it? → ARKit requires back camera only; code enforces this with alert.
- [x] Are we using 2D or 3D tracking currently? → 3D via ARKit; 2D projection overlay on top (`pose2D`).
- [ ] How do goals/objectives influence heuristics (explosive athletes vs. lifters, 1RM edge case)?
- [ ] Should logging be more centralized?
- [x] Should scan even be displayed on web? (probably not) → Already handled: web shows "Device not supported" state.
- [x] What is `Haptics.impactAsync()`? → `expo-haptics` for haptic feedback (used on rep completion, recording start, etc.)

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

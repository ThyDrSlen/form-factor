# Video Replay Harness (Pose Stream Replay) — Plan

## Why this exists
ARKit body tracking can’t be driven from a prerecorded `.mp4/.mov`. To regression-test new form heuristics/models on real sessions, we’ll **replay the pose stream we captured during the original recording** and run our model logic over it (deterministic, fast, and works on-device).

This plan is for the “Approach A” we discussed: **Replay recorded sessions using stored pose samples** (not re-running ARKit on the video).

## Goals
- Re-run form tracking / scoring / cue logic on **previously recorded sessions** with consistent inputs.
- Provide an in-app “Replay” experience: video playback + (optional) pose overlay + a timeline of reps/cues/scores.
- Enable **A/B comparison** between “baseline” vs “candidate” model logic/config without re-recording.
- Keep it cheap to iterate: no Xcode-only flows required for everyday validation.

## Non-goals (for this phase)
- Feeding video into ARKit directly (not supported).
- Re-estimating pose from video pixels (that’s “Approach B”: Vision offline pose extraction).
- Replies/threads in comments (unrelated).

## Current building blocks in this repo
- `pose_samples` table already exists and is indexed by `session_id`. See `supabase/migrations/016_create_pose_samples.sql`.
- Scan flow already generates a `sessionIdRef` and logs pose angles via `logPoseSample(...)` in `app/(tabs)/scan-arkit.tsx`.
- `pose_samples` already supports `joint_positions` JSONB and version fields (`model_version`, `cue_config_version`, etc.) via `supabase/migrations/017_extend_telemetry_tables.sql`.
- Videos have `metrics` JSONB (`supabase/migrations/013_add_video_metrics.sql`), which we can extend to link the video to a tracking session.

## Data we need to persist (minimum viable)
### 1) Link each recorded video to the pose stream
**Add to `videos.metrics` when uploading:**
- `sessionId`: string (e.g., `sessionIdRef.current`)
- `recordingStartFrameTimestamp`: number (AR/pose timestamp when recording started; used for sync)
- `recordingQuality`: `"low" | "medium" | "high"` (optional but nice for metadata)

**Why metrics JSON instead of a new column?**
- Zero DB migration.
- Enough for joining `video -> sessionId -> pose_samples`.

If we later want faster joins/queries, we can add a real `videos.session_id` column + index, but it’s not required for v1.

### 2) Store enough pose info to re-run models
**Already stored today (good):**
- angles, phase, repNumber, exerciseMode, `frame_timestamp`

**Needed soon for better replay/debug (recommended):**
- 3D joints (world): store in `pose_samples.joint_positions`
- 2D joints (view-normalized): store alongside 3D in the same JSONB (or add a new column if preferred)

Suggested JSONB shape (backward compatible):
```json
{
  "world": { "hips_joint": { "x": 0.0, "y": 0.0, "z": 0.0, "tracked": true } },
  "view":  { "hips_joint": { "x": 0.52, "y": 0.41, "tracked": true } }
}
```
Backward compatibility: older rows may have the “flat” `{ jointName: {x,y,z} }` shape — replay code should accept both.

### 3) Syncing pose samples to the video timeline
We need a stable mapping from video time (0…duration) to pose sample times.

Minimum viable sync strategy:
- Store `recordingStartFrameTimestamp` in `videos.metrics`.
- When replaying, compute:
  - `tSample = sample.frame_timestamp - recordingStartFrameTimestamp`
  - Find nearest sample for `videoCurrentTime` (seconds).

Fallback if missing:
- Use the first pose sample timestamp as the base.
- Provide a manual “offset” slider (±1–2s) in the replay UI to correct drift for old sessions.

## Product/UI flow
### Entry point
Add a new action on a video post (3-dot menu or long-press):
- **Replay session** (visible only if `video.metrics.sessionId` exists)

### Replay screen (modal or stack screen)
Key UI elements:
- Video player (`VideoView`) with scrubbing.
- “Model” selector (Baseline / Candidate) and optional “Compare” toggle.
- Timeline panel:
  - Rep count and phase over time
  - Cue events timeline (markers)
  - Form score over time (sparkline)
- Optional overlay:
  - Draw 2D joints on top of the video using `Svg` + normalized `view` joints from samples.

## Model evaluation pipeline (deterministic)
Create a pure evaluator that takes time-series samples and outputs consistent results:
```ts
evaluatePoseStream(samples, { modelVersion, cueConfigVersion, exerciseMode }) => {
  repCount,
  repBoundaries,
  cues: [{ t, type, payload }],
  scores: [{ t, score }],
  summary: { finalScore, keyIssues, ... }
}
```

### Baseline vs Candidate
- Baseline: current production heuristics/config.
- Candidate: new heuristics/config toggled via a local flag or “version” selector.

UI should show:
- delta in final score
- changed cue counts
- changed rep count (if applicable)
- a list of “largest differences” timestamps

## Storage + performance considerations
- Sampling rate: current `pose-logger` is 12 Hz. This is usually enough for model logic; overlay may look a bit choppy.
  - Optional improvement: when `isRecording === true`, temporarily bump sampling to 24–30 Hz, or separately store a higher-rate “overlay stream” locally and upload only when needed.
- Keep replay downloads bounded:
  - Query only samples within the video’s time window.
  - Paginate or stream if we later support longer recordings.

## Implementation steps (phased)
### Phase 1 — Link + replay without overlay (fast win)
1) Add `sessionId` + `recordingStartFrameTimestamp` into `uploadWorkoutVideo({ metrics })` from `scan-arkit`.
2) Add a `fetchPoseSamples(sessionId)` service (Supabase query ordered by `frame_timestamp`).
3) Create `app/(modals)/video-replay.tsx` (or similar) with:
   - video player
   - a simple per-time “nearest sample” lookup
   - a panel showing computed score + cues at the current time
4) Add “Replay session” action to video post menu.

### Phase 2 — Overlay + better sync
5) Log 2D joints into `pose_samples.joint_positions.view` (and 3D joints into `.world`).
6) Render joint overlay on replay video (`Svg` absolute fill).
7) Add manual offset slider for sessions missing a clean base timestamp.

### Phase 3 — A/B comparison + export
8) Add “Compare” mode and a diff view.
9) Add export/share:
   - JSON export of inputs + outputs for a session
   - optional Supabase `model_evaluations` table to store results across builds

## Acceptance criteria
- A video recorded from Scan has a “Replay session” action that opens a replay screen.
- Replay screen loads pose samples and can scrub through time while updating displayed model outputs.
- “Candidate vs Baseline” shows a clear delta summary (even if only a simple score/cue diff in v1).
- Works offline if samples are cached locally (optional for v1), and doesn’t crash if data is missing.

## Future (Approach B, later)
For old videos that don’t have pose samples, or to evaluate pose estimation changes:
- Run Vision `VNDetectHumanBodyPoseRequest` offline on video frames (no ARKit required).
- Persist extracted joints and feed them through the same evaluator.

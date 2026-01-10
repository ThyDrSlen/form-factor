# Subject Lock + Recording Overlay Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep form tracking “locked” to a single person when multiple people are in frame, and fix the recorded-video skeleton overlay shifting toward the upper-left at `low`/`medium` recording quality.

**Architecture:** Implement a native “subject lock” by tracking a chosen `ARBodyAnchor` identifier (with reacquire rules) so we don’t flip between candidates. Fix recording overlay misalignment by scaling the captured `CIImage` into the writer’s pixel buffer before drawing the overlay, so the video frame and overlay share the same coordinate space at all resolutions.

**Tech Stack:** Expo (React Native), Expo Modules (Swift), ARKit/RealityKit, AVFoundation, Core Image.

## Problem Statements

1) **Subject switching:** When another person is in the background, ARKit tracking can “jump” to them, causing form tracking to follow the wrong body.

2) **Recorded overlay offset at `low`/`medium`:** When recording quality is reduced, the skeleton overlay embedded into the recorded video becomes misaligned (appearing shifted toward the upper-left, often “disjointed”).

## Phase 0: Reproduce + Collect Evidence (Do this before any fixes)

### Manual repro for subject switching (baseline “failing test”)

1. On device, open `ScanARKit`.
2. Put **two people** in view (primary subject centered; another person behind/side).
3. Start tracking and observe if the tracked body changes (even briefly).
4. Capture:
   - Screen recording (preferred), or
   - A short video + a note of exact steps.

### Manual repro for overlay offset (baseline “failing test”)

1. Start tracking.
2. Record a ~5s clip at each quality:
   - `high` (control)
   - `medium`
   - `low`
3. In the in-app preview (fullscreen if needed), confirm whether the **embedded** skeleton overlay is aligned with the person.
4. Save one screenshot per quality for comparison.

### Add temporary debug logs (evidence gathering)

**Files:**
- Modify: `modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift`

**Step 1: Log body anchor candidates**

Add logs in `ARKitSessionDelegate.session(_:didUpdate anchors:)`:
- Count of `ARBodyAnchor`s in the update
- Each anchor’s `identifier` + `estimatedScaleFactor` + `isTracked`
- Which anchor is selected as `currentBodyAnchor`

Expected outcome:
- Confirm whether we truly receive multiple `ARBodyAnchor`s, and whether selection flips between them.

**Step 2: Log recording frame sizes**

Add logs in `ARVideoRecorder.appendFrame(...)` around the render path:
- `frame.capturedImage` width/height
- `outputBuffer` width/height (when using pixel buffer pool)
- The recording `preset` (`low|medium|high`) and target `width/height`

Expected outcome:
- Confirm mismatch between `frame.capturedImage` resolution and writer buffer resolution for `low/medium`.

## Phase 1: Subject Lock (Native selection + JS controls)

### Approach Options (choose 1)

**Option A (recommended): Auto-lock with hysteresis**
- When tracking starts, pick the best body anchor (largest `estimatedScaleFactor`) and “lock” to its `identifier`.
- While locked, ignore other anchors unless the locked one is missing/untracked for `N` consecutive updates (reacquire).
- Add a “Reacquire subject” button in UI that clears the lock.

**Option B: Always track “best” anchor (no lock)**
- Each update picks the best anchor (largest `estimatedScaleFactor`).
- Simpler, but will still switch when another person becomes “more prominent.”

**Option C: Manual selection**
- Render multiple candidates and allow tap-to-lock.
- Most accurate, but requires surfacing per-anchor 2D pose candidates to JS and extra UI/UX.

Recommendation: **Option A** first (fast, robust, good UX), then consider Option C if needed.

### Task 1: Add subject lock state to the native module

**Files:**
- Modify: `modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift`

**Step 1: Add state**

In `ARKitBodyTrackerModule`, add:
- `var subjectLockEnabled: Bool = true`
- `var lockedBodyAnchorId: UUID?`
- `var lockedBodyAnchorLastSeenTs: TimeInterval = 0`
- `var lockedMissingCount: Int = 0`

**Step 2: Add Expo module functions**

Expose minimal control for JS:
- `Function("setSubjectLockEnabled") { (enabled: Bool) in ... }`
- `Function("resetSubjectLock") { ... }`

**Step 3: Thread-safety**

Ensure these writes occur on main queue (match existing ARKit usage).

### Task 2: Select / maintain current body anchor deterministically

**Files:**
- Modify: `modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift`

**Step 1: Collect candidates in `didUpdate anchors`**

```
let bodies = anchors.compactMap { $0 as? ARBodyAnchor }
guard !bodies.isEmpty else { return }
```

**Step 2: If lock enabled and locked id exists, prefer it**

```
if subjectLockEnabled, let lockedId = owner.lockedBodyAnchorId,
   let locked = bodies.first(where: { $0.identifier == lockedId }) {
  owner.currentBodyAnchor = locked
  owner.lockedMissingCount = 0
  owner.lockedBodyAnchorLastSeenTs = CACurrentMediaTime()
  return
}
```

**Step 3: If locked id missing, apply reacquire rules**

- Increment `lockedMissingCount`.
- If the locked anchor is absent but fewer than ~4 seconds have elapsed (track via `CACurrentMediaTime()` vs `lockedBodyAnchorLastSeenTs` and a ~4s tolerance), keep the existing `currentBodyAnchor` and return (prevents flips when the subject briefly disappears between sets).
- Once the ~4s threshold is exceeded, clear the lock and reacquire from candidates.

**Step 4: When choosing a new lock, pick “best”**

Pick candidate with max `estimatedScaleFactor`:
```
let best = bodies.max(by: { $0.estimatedScaleFactor < $1.estimatedScaleFactor })
owner.currentBodyAnchor = best
owner.lockedBodyAnchorId = subjectLockEnabled ? best?.identifier : nil
owner.lockedMissingCount = 0
```

**Step 5: Clear lock on removal**

In `didRemove anchors`, if an anchor’s `identifier` matches `lockedBodyAnchorId`, clear `lockedBodyAnchorId` and `currentBodyAnchor`.

### Task 3: Wire JS controls (optional but recommended UX)

**Files:**
- Modify: `lib/arkit/ARKitBodyTracker.ios.ts`
- Modify: `app/(tabs)/scan-arkit.tsx`
- Modify: `styles/tabs/_scan-arkit.styles.ts` (if new UI)

**Step 1: Add JS wrappers**

Add:
- `BodyTracker.setSubjectLockEnabled(enabled: boolean)`
- `BodyTracker.resetSubjectLock()`

**Step 2: Add UI**

In `ScanARKit`:
- Toggle: “Lock Subject” (default ON)
- Button: “Reacquire” (calls `resetSubjectLock()`)

**Step 3: Manual verification**

Re-run the **two-person repro**:
- Expect tracking to stay on the primary subject.
- If the locked subject fully leaves frame, expect a short “lost” period then reacquire.

## Phase 2: Fix Recorded Overlay Offset at `low`/`medium`

### Working Hypothesis (to confirm in Phase 0 logs)

`ARVideoRecorder` renders `CIImage(cvPixelBuffer: frame.capturedImage)` into a **smaller** `outputBuffer` without scaling, causing the video frame to be effectively **cropped** (top-left). The overlay coordinates are computed in full-frame normalized space, so the overlay appears shifted toward the upper-left when written into the cropped buffer.

### Task 4: Scale the captured image into the writer buffer before drawing overlay

**Files:**
- Modify: `modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift`

**Step 1: Add a helper to render scaled**

Within `ARVideoRecorder`:
- Compute `targetW/targetH` from `outputBuffer`
- Compute a uniform scale factor based on `baseImage.extent`
- Transform the `CIImage` so it fits `targetW/targetH`
- Render the transformed image into `outputBuffer`

Pseudo-code:
```
let baseImage = CIImage(cvPixelBuffer: frame.capturedImage)
let source = baseImage.extent.size
let target = CGSize(width: targetW, height: targetH)
let scale = min(target.width / source.width, target.height / source.height)
let scaled = baseImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
// If needed, translate to center; then crop to target rect.
ciContext.render(scaled, to: outputBuffer)
```

**Step 2: Keep overlay transform logic unchanged initially**

Continue using:
`frame.displayTransform(for: orientation, viewportSize: viewportSize).inverted()`

Re-test after scaling; only adjust transforms if alignment is still off.

### Task 5: Slim the overlay graphics (live + recorded)

**Files:**
- Modify: `app/(tabs)/scan-arkit.tsx`
- Modify: `modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift`

**Step 1: Halve the SVG stroke widths and joint circle radius**

- In the JSX overlay markup (currently `strokeWidth="0.008"` and `r="0.012"`), halve those values so the live vector overlay draws much thinner lines while maintaining the same normalized coordinates.

**Step 2: Match the native overlay**

- In `drawOverlay`, reduce `lineWidth` and `jointRadius` (derived from `minDim * 0.008` / `*0.012`) to the same fractions so the recorded overlay matches the slimmer appearance.

**Step 3: Check cross-quality appearance**

- Record quick clips at `high` and `medium` to ensure the slimmer overlay still aligns and remains visible when drawn into the native recording buffer.

### Task 6: Gesture-triggered recording

**Files:**
- Modify: `app/(tabs)/scan-arkit.tsx`
- Consider adding helper logic to `lib/workouts/` or `hooks/` if the gesture detection grows beyond the component.

**Step 1: Define a reliable gesture**

- Use the existing pose data (e.g., both wrists above shoulders for >0.5s while hands remain tracked) as the trigger pattern.
- Optionally add simple directionality (hands moving toward each other) to prevent noise.

**Step 2: Automatically start recording**

- When the gesture condition is satisfied and `isRecording` is false, call `startRecordingVideo()` from the component.
- Provide immediate visual feedback (Toast or subtle overlay text) so the user knows recording started due to the gesture.

**Step 3: Add user control**

- Expose a `gestureRecordingEnabled` toggle (default `true`) next to the existing quality controls so the user can disable auto-recording.
- Require the gesture to hold steadily for ~0.5s before triggering to avoid false positives.

### Task 7: Manual verification matrix
**Step 1: Record 5s clips**
- `high`, `medium`, `low`

**Step 2: Verify**
- The recorded video frame shows full view (no crop/zoom surprise).
- The skeleton overlay is aligned in all qualities.

**Step 3: Regression checks**
- Recording start/stop still works.
- No new performance issues (watch for dropped frames).

## Validation Checklist

- `bun run lint`
- `bun test` (if available/used in this repo)
- iOS device sanity check:
  - Subject lock scenario with two people
  - Recording overlay alignment across qualities
  - Watch mirroring still updates

## Notes / Open Questions

- If ARKit only ever provides **one** `ARBodyAnchor`, subject “switching” may be ARKit reassigning the tracked body internally. The lock logic will still prevent rapid flips, but UX might need “reacquire” prompts if ARKit insists on picking the wrong person.
- If we later want truly reliable multi-person selection, consider adding a Vision-based multi-person detector and using ARKit pose only after selecting the person of interest.

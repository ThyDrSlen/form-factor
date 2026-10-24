# Exercise replay: record once, rerun the real controller

## What this validates

The replay lab feeds captured `controller-input` frames through the same `useWorkoutController` used by Scan: the workout registry, phase FSM, adaptive timing, rep boundaries, FQI and fault scoring. The driver is not another rep detector.

Frame timestamps drive the controller, not playback wall time. Step, Run, Restart and programmatic seek all preserve input intervals. Seek resets the controller and replays the prefix rather than jumping over stateful history. Captured controller resets, including tracking-loss resets, are applied in order with their original preserve-rep-count behavior. Replay mode suppresses rep persistence, retry writes and haptics. The lab does not use scan-session, Watch or audio callbacks.

This is **not** raw video/ARKit replay. Captures occur after Scan's preprocessing and quality gates. This cannot validate changes to native inference, smoothing, calibration, occlusion gates, camera geometry, live cue delivery or Watch transport. Keep occasional physical-device checks for those paths. Existing pull-up fixture playback and the web fixture viewer are separate tools, not evidence of parity for this engine.

## Record a real set once (development build only)

To try playback without recording anything, open **Scan → Settings → Exercise replay lab**, select **Load synthetic curl demo**, then **Run**. This should show one rep with FQI 95; **Restart** lets you repeat or step through it. This demo is generated data, not a real camera recording.

1. Open Scan, open its Settings sheet, and select **Exercise replay lab**.
2. Consent to local saving, then select **Arm next scan recording**.
3. Close the lab. Select the exercise, start tracking, perform one representative set and stop tracking.
4. Return to the lab and **Load latest capture**.
5. Use **Step**, **Run**, and **Restart** to inspect phase, rep count and latest FQI without exercising again.
6. **Export JSON** opens the iOS share sheet so you can save the file on your Mac. **Import JSON** loads a previously exported trace.

Capture is opt-in, developer-only, local to the app, and bounded to 18,000 frames. It records angles, optional joint coordinates/confidences and quality context, not video. One latest file is retained, replacing the previous capture. Export useful sets before capturing another. Changing the exercise/source or unmounting Scan discards an active capture, as do invalid or backwards timestamps. Tracking-loss controller resets do not discard capture: they are saved as reset events. An unused arm remains armed until a real scan starts or **Cancel capture** is selected.

Recorded/synthetic provenance is an explicit file label, not cryptographic proof. Never relabel generated fixtures as real recordings.

## Headless regression command

From the repository root:

    bun run replay:exercise /absolute/path/to/captured-set.json --output=/tmp/replay-report.json

This runs the actual React Native hook in the existing Jest/Expo environment. It executes the input twice (batch and stepped), requires identical phase transitions, rep counts and per-rep FQI/faults, verifies no rep writes/haptics, and exits nonzero on validation failures. It does not launch the camera or a simulator. The report is written after successful checks only.

A synthetic smoke fixture is included, explicitly marked synthetic:

    bun run replay:exercise tests/fixtures/exercise-replay/synthetic-curl.json --output=/tmp/curl-replay.json

This is a controlled one-curl timing case, not evidence of real-world tracking accuracy.

A second synthetic fixture inserts a 30-second silence before the completion frame:

    bun run replay:exercise tests/fixtures/exercise-replay/synthetic-curl-silent-gap.json --output=/tmp/curl-silent-gap-replay.json

It must produce **zero reps**, not complete the interrupted curl. The controller discards pending phase transitions and unfinished rep data when accepted frames are at least 4 seconds apart, matching the native subject-lock timeout. Completed reps and pending persistence retries remain intact. Live and replay derive this continuity check from their respective frame clocks; no explicit reset event is required for a silent gap. Continuous frames during a slow movement do not trigger this timeout.

This guard runs when the next frame arrives. It does not detect a stalled camera immediately or validate the live tracking-loss UI.

A backwards live wall-clock jump also discards unfinished motion and pending transitions while preserving completed reps. Equal timestamps remain accepted. Replay continues to reject backwards timestamps rather than simulating a live clock correction.

The iOS polling hook retains its last sensor timestamp across tracking loss and stop/start. Returning the same cached frame cannot restore the pose; a different sensor timestamp is required. This prevents stale-frame resurrection, but is not a timeout for a continuously frozen native feed. A physical-device check is still required for camera recovery.

## Human labels and validity

After independently counting reps in a recorded set, optionally add a top-level `expectedRepCount` integer. The command will fail if current detection disagrees. Do not copy the app's count as ground truth; that only blesses its existing errors. Unlabelled recordings test determinism, not rep-count accuracy. FQI is compared for determinism, not against an independently labelled form-quality score.

The version-1 JSON envelope contains:

- `version: 1`
- `source: "recorded"` or `"synthetic"`
- `stage: "controller-input"`
- `workoutId`: any registered detection mode
- `frames`: a nonempty array, in original order
- optional `resets`: ordered `{ beforeFrame, preserveRepCount }` events. `beforeFrame` is a zero-based frame index; `frames.length` applies a final reset after the last frame. Consecutive resets at the same position are combined, retaining any request to clear the rep count.
- optional `expectedRepCount`: independent human label

Each frame contains `timestampMs`, all eight `JointAngles`, optional `joints` (coordinate/tracked/confidence records), and optional `context` (`trackingQuality`, `shadowMeanAbsDelta`). Timestamps are milliseconds and must be nondecreasing: distinct frames accepted within one millisecond retain their order and identical timestamps. Backwards timestamps are rejected. ARKit `timestampSec` arrays and throttled Supabase pose rows cannot be passed in as equivalent lossless recordings. The driver rebases to a fixed positive clock and never invents missing quality or confidence values.

The controller itself accepts explicit timestamps only when `executionMode: 'replay'`. Live callers retain their wall clock and normal persistence behavior. Replay requires a separate controller; do not switch a running live session into replay.

## Automated checks

    bun run test --runInBand --runTestsByPath tests/unit/lib/exercise-replay.test.ts tests/unit/lib/exercise-replay-cli.test.ts tests/unit/hooks/use-workout-controller-replay.test.tsx tests/integration/exercise-replay.test.tsx

Additional replay-screen and capture-store tests cover consent, fixture exclusion, interruption, local saving and controls. Keep captured personal traces local unless explicitly approved for inclusion in the repository.

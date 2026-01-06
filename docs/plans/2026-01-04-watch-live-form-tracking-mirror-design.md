# Watch Live Form Tracking Mirror (Apple Watch) — Design + Plan

## Context (current repo state)
- A watchOS app target exists under `ios/Form Factor Watch Watch App/*` and already supports:
  - Receiving low-FPS camera “mirror” frames (`frame` base64) + simple state (`isTracking`, `reps`).
  - Sending basic commands to the iPhone app (`command: "start" | "stop"`).
- The iPhone-side JS bridge is currently stubbed/disabled in `lib/watch-connectivity.ts`, so the watch mirror + commands can’t actually work end-to-end yet.
- `app/(tabs)/scan-arkit.tsx` already contains the hooks to:
  - Stream ARKit back-camera snapshots to the watch (`type: "mirror"`, `frame`, etc).
  - Sync tracking state (`isTracking`, `reps`) and listen for commands via `watchEvents`.

## Goal
Re-enable iPhone ↔︎ Apple Watch connectivity and mirror the **live form tracking UI state** (reps, phase, cues, key metrics) on the watch in real time, alongside the existing low-FPS camera preview mirror.

In other words: the watch should show what the iPhone “Analyze / tracking” experience is doing (live inputs), similar in spirit to the existing camera mirror behavior.

## Non-goals (for MVP)
- High-FPS video mirroring.
- Pixel-perfect “screenshot mirroring” of the iPhone UI.
- Android/WearOS support.
- Full workout browsing/editing from the watch.

## Approaches considered

### A) UI screenshot mirroring (true UI mirror)
Capture the iPhone view and stream it as images to the watch.
- Pros: Looks exactly like the iPhone UI.
- Cons: Hard/fragile in RN/Expo, heavy bandwidth, likely low FPS anyway, lots of edge cases (privacy overlays, view lifecycle, animations).

### B) Data mirroring (structured tracking state → native watch UI)
Send a structured “tracking state” payload (reps/phase/cues/metrics), and render a purpose-built watch UI.
- Pros: Low bandwidth, robust, easy to evolve, enables watch-side UX that fits the screen.
- Cons: Not a 1:1 UI mirror; requires watch UI work.

### C) Hybrid (recommended): camera preview + data overlay
Keep the low-FPS camera mirror, and **overlay** (and/or provide a second screen for) reps/phase/cues/metrics.
- Pros: Matches the existing mental model (“mirror on watch”) while also showing the live form tracking state.
- Cons: Slightly more UI work than (B), but still far simpler than screenshot mirroring.

## Decision
- Adopt **Approach C (Hybrid)**: camera preview + live tracking state overlay.
- Implement **two watch screens**: **Mirror** + **Metrics**.

## Proposed UX (watchOS)

### Screens
1) **Mirror** (default)
   - Shows the incoming camera snapshot (`frame`) like today.
   - Overlays:
     - Rep count (large)
     - Current phase (short label)
     - Primary cue (single line)
2) **Metrics**
   - Big rep count
   - Phase
   - A few movement-specific metrics (examples below)
   - Last updated time + reachability indicator

Navigation can be either:
- `TabView` with swipe between Mirror/Metrics, or
- A single view with a “mode” toggle.

### Controls (MVP)
- Start / Stop buttons (already exist).
- Optional stretch: haptic on rep increment (watch-side).

## Data model + message protocol

### Transport
Use `WatchConnectivity` (`WCSession`) with two lanes:
- **`sendMessage`** for real-time interactions when reachable (commands + cue changes + mirror frames).
- **`updateApplicationContext`** for “latest state” (tracking + health summaries). The watch always gets the last context when it becomes active.

### Versioned payloads
Every outbound payload from iPhone includes:
- `v: 1` (schema version)
- `ts: number` (ms since epoch)
- Optional `type` string for easier filtering/debugging

### Tracking state (live inputs)
Send as `applicationContext` (throttled) and also as `sendMessage` on major changes.

Example payload:
```ts
{
  v: 1,
  type: "tracking",
  ts: 1735958400000,
  tracking: {
    isTracking: true,
    mode: "pullup" | "pushup",
    phase: string,
    reps: number,
    primaryCue: string | null,
    metrics: {
      // pullup
      avgElbowDeg?: number | null,
      avgShoulderDeg?: number | null,
      headToHand?: number | null,
      // pushup
      hipDropRatio?: number | null
    }
  }
}
```

Notes:
- Keep `isTracking` and `reps` also at the top-level for backward-compat with the current watch code, then migrate watch to prefer `tracking.*`.
- Keep payload small; avoid per-joint streams for MVP.

### Mirror frames (camera preview)
Send via `sendMessage` only when reachable:
```ts
{
  v: 1,
  type: "mirror",
  ts: 1735958400000,
  frame: "<base64 jpeg>",
  width?: number,
  height?: number,
  orientation?: string,
  mirrored?: boolean,
  cameraPosition?: "back"
}
```

### Commands (watch → iPhone)
Watch sends:
```ts
{ v: 1, ts: ..., command: "start" | "stop" }
```
Optional later:
- `command: "toggleMirror"`
- `command: "toggleAudioCues"`
- `command: "setMode", mode: "pullup" | "pushup"`

## iPhone-side architecture (Expo + native module)

### 1) Add an Expo native module for iOS: `modules/ff-watch-connectivity`
- Swift module implements:
  - Session setup + delegate callbacks
  - `sendMessage(payload)`
  - `updateApplicationContext(context)`
  - `getReachability()`, `getIsPaired()`, `getIsWatchAppInstalled()`
  - Event emission to JS:
    - `message` (incoming dict)
    - `reachability` (bool)
    - `paired` (bool)
    - `installed` (bool)

### 2) JS wrapper: platform-specific `lib/watch-connectivity.ios.ts`
- Mirrors the API already imported in `scan-arkit.tsx`:
  - `watchEvents.addListener(eventName, cb)`
  - `sendMessage(message)`
  - `updateApplicationContext(context)`
  - `updateWatchContext(patch)` (keeps a local “latest” object)
  - `getReachability()`, `getIsPaired()`, `getIsWatchAppInstalled()`
- Keep `lib/watch-connectivity.ts` as the fallback stub (non-iOS / types).

### 3) Publish “live tracking inputs” from `scan-arkit.tsx`
- Add a throttled “tracking state publish” effect (e.g. 4–8 Hz max) that pushes:
  - `detectionMode`, `phase`, `reps`, `primaryCue`, and selected metrics.
- On cue change, send an immediate `sendMessage({ type: "tracking", ... })` so the watch feels responsive.
- Mirror frames remain on their existing timer (`WATCH_MIRROR_INTERVAL_MS = 750`).

### 4) Keep HealthKit context updates working
`contexts/HealthKitContext.tsx` already calls `updateWatchContext({ steps, heartRate })`.
- For MVP, allow “flat” keys to coexist with `tracking.*`.
- If it becomes messy, move to `health: { steps, heartRate }` in a follow-up.

## watchOS app changes (SwiftUI)

### 1) Extend `WatchSessionManager`
Add published fields for:
- `mode`, `phase`, `primaryCue`
- `metrics` (small struct or dictionary)
- Keep existing `lastFrame`, `isTracking`, `reps`, reachability, timestamps

Update `handleIncoming(_:)` to:
- Prefer nested `tracking` payload when present
- Fall back to top-level `isTracking` / `reps`
- Update UI on main thread (already)

### 2) Update `ContentView`
- Mirror view overlays metrics/cue on top of the image.
- Add a second view for metrics, or a simple toggle to switch layout.

## Performance + reliability notes
- Never try to “guarantee delivery” for mirror frames; drop is fine.
- Throttle tracking-state updates; prefer `applicationContext` for last-known.
- Keep payload JSON-simple (`String`, `Bool`, `Int/Double`, small dictionaries).
- Decode base64 frames off the main thread (already done).

## Testing plan

### Manual (recommended for first pass)
- Install watch app on a simulator pair using `bun run watch:install "Apple Watch Series 9 (45mm)"`.
- Run the iOS app, open `Scan`, enable watch mirror.
- Validate:
  - Reachability status updates on watch and iPhone UI
  - Start/Stop from watch triggers tracking on iPhone
  - Rep count + phase + cue update live on watch
  - Mirror frame updates at low FPS when reachable

### Automated
- JS unit test for “message shaping” (tracking payload builder + throttling logic) if we extract helpers.
- Native tests are optional (existing Swift tests live under `modules/arkit-body-tracker/ios/*Tests.swift`, but watch connectivity is hard to fully simulate).

## Phased implementation plan
1) Implement iOS native watch connectivity module + JS wrapper; get reachability + commands working end-to-end.
2) Re-enable mirror frames (existing code path) and validate watch displays video snapshots again.
3) Add tracking state mirroring (mode/phase/cues/metrics) + watch UI updates.
4) Tune throttles + payload sizes; add haptics on rep increments (optional).

## Acceptance criteria (MVP)
- With iPhone app foregrounded on `Scan`, watch shows:
  - live rep count + phase + primary cue (updates within ~1s)
  - camera mirror preview (low FPS) when enabled and reachable
- Watch Start/Stop reliably controls iPhone tracking.
- No crashes when watch disconnects/reconnects; UI degrades gracefully (“not reachable”).

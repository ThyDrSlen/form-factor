#!/usr/bin/env python3
"""Run actual WatchSessionManager logic on macOS with mocked Apple UI/WC boundaries.

Only imports and @Published wrappers are removed from the temporary source;
production methods are not rewritten. Native compilation remains a separate check.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "targets/watch-app/WatchSessionManager.swift"
NATIVE = ROOT / "ios/Form Factor Watch Watch App/WatchSessionManager.swift"
assert SOURCE.read_bytes() == NATIVE.read_bytes(), "Watch manager sources drifted"
assert (SOURCE.parent / "ContentView.swift").read_bytes() == (NATIVE.parent / "ContentView.swift").read_bytes(), "Watch UI sources drifted"
source = SOURCE.read_text()
for module in ("SwiftUI", "UIKit", "WatchConnectivity", "Combine"):
    source = source.replace(f"import {module}\n", "")
source = source.replace("@Published ", "")
with tempfile.TemporaryDirectory(prefix="form-factor-watch-tests-") as directory:
    directory = Path(directory)
    manager = directory / "WatchSessionManager.swift"
    manager.write_text(source)
    executable = directory / "watch-tests"
    subprocess.run(["xcrun", "swiftc", "-swift-version", "5", "-parse-as-library",
                    str(ROOT / "tests/watch/WatchPlatformStubs.swift"), str(manager),
                    str(ROOT / "tests/watch/WatchSessionManagerTests.swift"),
                    "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True)

# Small source contracts for SwiftUI wiring; actual SwiftUI compiles separately.
ui = (SOURCE.parent / "ContentView.swift").read_text()
assert 'Button(session.pendingCommand == "start" ? "Starting…" : "Start")' in ui, "Start must render pending feedback"
assert 'Button(session.pendingCommand == "stop" ? "Stopping…" : "Stop")' in ui, "Stop must render pending feedback"
assert '.disabled(session.pendingCommand != nil)' in ui, "Controls must disable while pending"
updated_row = ui.split('private struct UpdatedRow: View {', 1)[1]
assert updated_row.index('if let status = session.statusMessage') < updated_row.index('if let updated = session.lastUpdated'), "Request/error feedback must not be hidden by a previous frame timestamp"
assert '.lineLimit(3)' in updated_row, "Actionable feedback needs room on Watch"
print("PASS: SwiftUI pending-control and visible-status wiring contracts")

mirror = ui.split('private struct MirrorScreen: View {', 1)[1].split('private struct MetricsScreen: View {', 1)[0]
assert 'Text("Sampled preview")' in mirror, "Preview must be labeled as sampled, not full-rate video"
assert 'TimelineView(.periodic(from: .now, by: 0.5))' in mirror, "Preview must expire without incoming messages"
assert 'let now = max(context.date, Date())' in mirror, "New frames between timeline ticks must not appear future-dated and flicker"
assert 'if session.hasFreshFrame(at: now), let frame = session.lastFrame' in mirror, "Only fresh, reachable, tracking frames may be rendered"
assert 'session.lastUpdated' not in mirror, "Tracking updates must not extend preview freshness"
assert 'if !session.isReachable' in mirror and 'Preview paused: iPhone not reachable' in mirror, "Disconnected preview must explain why it is paused"
assert 'else if !session.isTracking' in mirror and 'Preview paused: tracking stopped' in mirror, "Stopped tracking must pause the preview"
assert 'Waiting for fresh preview' in mirror, "Missing or stale frames must show waiting feedback"
for preserved in ('session.reps', 'session.phase', 'session.primaryCue', 'ControlsRow()', 'StatusRow()', 'UpdatedRow()'):
    assert preserved in mirror, f"Sampled preview must preserve {preserved}"
print("PASS: SwiftUI sampled-preview expiry, visibility, and placeholder wiring contracts")

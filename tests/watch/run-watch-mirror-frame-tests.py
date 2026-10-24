#!/usr/bin/env python3
"""Exercise the production native frame-age predicate without ARKit hardware."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift').read_text()
start = source.find('enum WatchMirrorFrameFreshness {')
assert start >= 0, 'Native mirror frame-age guard is missing'
end = source.index('\npublic class ARKitBodyTrackerModule', start)
predicate = source[start:end]
body = source[source.index('  private func makeSnapshotPayload('):source.index('  private func resolveMediaPipeModelPath(')]
assert 'viewport == nil || WatchMirrorFrameFreshness.accepts(' in body, 'Raw camera snapshots must keep existing behavior'
assert 'now: CACurrentMediaTime()' in body, 'Compare frame capture time with the host monotonic clock'
assert body.count('guard isFresh() else { return nil }') == 2, 'Check freshness before encoding and before returning'
tests = '''
func check(_ name: String, _ value: Bool) {
  precondition(value, name)
  print("PASS: " + name)
}
check("current frame", WatchMirrorFrameFreshness.accepts(timestamp: 100, now: 100))
check("fresh frame", WatchMirrorFrameFreshness.accepts(timestamp: 100, now: 101.499))
check("exact expiry", !WatchMirrorFrameFreshness.accepts(timestamp: 100, now: 101.5))
check("retained old frame", !WatchMirrorFrameFreshness.accepts(timestamp: 100, now: 120))
check("future frame", !WatchMirrorFrameFreshness.accepts(timestamp: 101, now: 100))
check("invalid frame clock", !WatchMirrorFrameFreshness.accepts(timestamp: .nan, now: 100))
check("invalid current clock", !WatchMirrorFrameFreshness.accepts(timestamp: 100, now: .infinity))
check("invalid initial timestamp", !WatchMirrorFrameFreshness.accepts(timestamp: 0, now: 0))
'''
with tempfile.TemporaryDirectory(prefix='watch-mirror-frame-') as directory:
    path = Path(directory) / 'main.swift'
    path.write_text('import Foundation\n' + predicate + tests)
    subprocess.run(['xcrun', 'swift', str(path)], check=True)
print('PASS: native mirror-only entry and post-encoding freshness guards')

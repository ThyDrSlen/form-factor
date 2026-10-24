import Foundation

@main
struct WatchSessionManagerTests {
  static var failures = 0
  static func expect(_ condition: @autoclosure () -> Bool, _ description: String) {
    if condition() { print("PASS: \(description)") }
    else { failures += 1; print("FAIL: \(description)") }
  }

  @MainActor static func testFrameReceiptFreshness() async {
    WCSession.default.reset()
    let manager = WatchSessionManager()
    expect(manager.lastFrameReceivedAt == nil, "preview has no receipt time before an accepted frame")
    manager.session(WCSession.default, didReceiveMessage: ["ts": 10, "tracking": ["isTracking": true]])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(manager.lastUpdated != nil && manager.lastFrameReceivedAt == nil, "tracking alone never creates preview freshness")

    let beforeReceipt = Date()
    manager.session(WCSession.default, didReceiveMessage: ["frame": "AQ==", "ts": 100])
    try? await Task.sleep(nanoseconds: 20_000_000)
    let receivedAt = manager.lastFrameReceivedAt
    expect(receivedAt != nil && receivedAt! >= beforeReceipt && receivedAt! <= Date(), "accepted decoded frame records local receipt time, not sender time")
    let frame = manager.lastFrame
    manager.session(WCSession.default, didReceiveMessage: ["ts": 11, "tracking": ["isTracking": false]])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(manager.lastUpdated != receivedAt && manager.lastFrameReceivedAt == receivedAt, "tracking update cannot extend frame freshness")
    for invalidClock: Any in [99, 100, Double.infinity, -1, "invalid"] {
      manager.session(WCSession.default, didReceiveMessage: ["frame": "Ag==", "ts": invalidClock])
    }
    manager.session(WCSession.default, didReceiveMessage: ["frame": "Ag=="])
    manager.session(WCSession.default, didReceiveMessage: ["frame": "", "ts": 1000])
    manager.session(WCSession.default, didReceiveMessage: ["frame": "A", "ts": 1001])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(manager.lastFrame === frame && manager.lastFrameReceivedAt == receivedAt, "rejected clocks, failed image decode, and invalid base64 never refresh preview")

    manager.session(WCSession.default, didReceiveMessage: ["frame": "Ag==", "ts": 101])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(!manager.isTracking && manager.lastFrame !== frame && manager.lastFrameReceivedAt! > receivedAt!, "new accepted frame refreshes receipt even while stopped and unreachable")
    let legacy = WatchSessionManager()
    legacy.session(WCSession.default, didReceiveMessage: ["frame": "AQ=="])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(legacy.lastFrame != nil && legacy.lastFrameReceivedAt != nil, "accepted legacy image receives independent freshness without requiring tracking")
  }

  @MainActor static func testPreviewVisibility() async {
    WCSession.default.reset()
    let manager = WatchSessionManager()
    manager.isReachable = true
    manager.isTracking = true
    expect(!manager.hasFreshFrame(at: Date()), "preview waits when no image has arrived")
    manager.session(WCSession.default, didReceiveMessage: ["frame": "AQ=="])
    try? await Task.sleep(nanoseconds: 20_000_000)
    guard let receipt = manager.lastFrameReceivedAt else {
      expect(false, "visibility fixture receives a decoded frame")
      return
    }
    expect(manager.hasFreshFrame(at: receipt), "new receipt is immediately visible while tracking and reachable")
    expect(manager.hasFreshFrame(at: receipt.addingTimeInterval(2.999)), "preview remains visible just before three seconds")
    expect(!manager.hasFreshFrame(at: receipt.addingTimeInterval(3)), "preview expires exactly at three seconds without another message")
    expect(!manager.hasFreshFrame(at: receipt.addingTimeInterval(60)), "retained stale image cannot reappear after a long gap")
    expect(!manager.hasFreshFrame(at: receipt.addingTimeInterval(-1)), "backwards clock cannot present an unbounded fresh preview")
    manager.isReachable = false
    expect(!manager.hasFreshFrame(at: receipt), "disconnect hides even a newly received frame")
    manager.isReachable = true
    manager.isTracking = false
    expect(!manager.hasFreshFrame(at: receipt), "stopped tracking hides even a newly received frame")
    expect(manager.lastFrame != nil && manager.lastFrameReceivedAt == receipt, "visibility gating preserves accepted frame and legacy receipt semantics")
    manager.isTracking = true
    manager.lastFrame = nil
    expect(!manager.hasFreshFrame(at: receipt), "receipt time without an image cannot display a preview")
  }

  @MainActor static func main() async {
    WCSession.default.reset()
    let manager = WatchSessionManager()
    manager.sendCommand("start")
    expect(manager.statusMessage == "iPhone not reachable — open Form Factor on iPhone.", "unreachable command provides immediate actionable feedback")
    expect(WCSession.default.messages.isEmpty, "unreachable tracking command is not queued for unsafe later execution")
    expect(!manager.isTracking, "unreachable start never claims tracking succeeded")
    WCSession.default.reset()
    WCSession.default.isReachable = true
    let reachable = WatchSessionManager()
    reachable.sendCommand("start")
    expect(reachable.statusMessage == "Start requested — waiting for iPhone.", "reachable start gives immediate pending feedback")
    expect(!reachable.isTracking, "sending a command is not successful tracking")
    reachable.sendCommand("start")
    reachable.sendCommand("stop")
    expect(WCSession.default.messages.count == 1, "only one unconfirmed command is in flight")
    let firstFailure = WCSession.default.failures[0]
    firstFailure(NSError(domain: "WatchTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Transport failed"]))
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(reachable.pendingCommand == nil, "transport error releases pending control")
    reachable.sendCommand("stop")
    expect(WCSession.default.messages.count == 2, "user may retry after transport failure")
    firstFailure(NSError(domain: "WatchTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Late old error"]))
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(reachable.statusMessage == "Stop requested — waiting for iPhone.", "late error cannot overwrite newer request")
    try? await Task.sleep(nanoseconds: 5_100_000_000)
    expect(reachable.pendingCommand == nil, "one-shot timeout releases unconfirmed control")
    expect(reachable.statusMessage == "No confirmation — check tracking on iPhone before retrying.", "timeout is uncertain, never reported as success or definite failure")
    expect(!reachable.isTracking, "timeout never optimistically changes tracking")
    WCSession.default.reset()
    WCSession.default.isReachable = true
    let ordered = WatchSessionManager()
    func snapshot(_ timestamp: Double, _ tracking: Bool, _ reps: Int = 0) -> [String: Any] {
      ["type": "tracking", "ts": timestamp, "tracking": ["isTracking": tracking, "reps": reps]]
    }
    ordered.session(WCSession.default, didReceiveMessage: snapshot(100, false))
    try? await Task.sleep(nanoseconds: 20_000_000)
    ordered.sendCommand("start")
    ordered.session(WCSession.default, didReceiveApplicationContext: snapshot(100, true, 9))
    ordered.session(WCSession.default, didReceiveMessage: snapshot(99, true, 8))
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(!ordered.isTracking && ordered.reps == 0, "duplicate context and older tracking snapshot cannot regress state")
    expect(ordered.pendingCommand == "start", "replayed snapshots cannot resolve a request")
    ordered.session(WCSession.default, didReceiveMessage: snapshot(101, false))
    ordered.session(WCSession.default, didReceiveMessage: ["type": "mirror", "frame": "AQ==", "ts": 1000])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(ordered.statusMessage == "Start requested — waiting for iPhone.", "unrelated frame and nonmatching tracking preserve request feedback")
    ordered.session(WCSession.default, didReceiveMessage: snapshot(102, true, 2))
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(ordered.isTracking && ordered.reps == 2, "new tracking snapshot reconciles reported state independently of mirror timestamp")
    expect(ordered.pendingCommand == nil, "observed desired state releases pending request")
    expect(ordered.statusMessage == "iPhone reports tracking.", "state reconciliation describes observation, not a command acknowledgement")
    ordered.session(WCSession.default, didReceiveMessage: ["isTracking": false, "reps": 10])
    ordered.session(WCSession.default, didReceiveMessage: snapshot(.infinity, false))
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(ordered.isTracking && ordered.reps == 2, "unversioned and invalid-clock payloads cannot overwrite ordered tracking")
    ordered.sendCommand("finish")
    expect(WCSession.default.messages.count == 1, "workout finish cannot accidentally be sent over scan-only command channel")
    ordered.sendCommand("stop")
    WCSession.default.isReachable = false
    ordered.sessionReachabilityDidChange(WCSession.default)
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(ordered.pendingCommand == nil, "disconnect releases pending control without replay")
    expect(ordered.statusMessage == "Connection lost — check tracking on iPhone.", "disconnect does not claim the command failed or succeeded")
    expect(ordered.isTracking, "disconnect does not invent stopped state")
    let observed = WatchSessionManager()
    WCSession.default.isReachable = true
    observed.sendCommand("start")
    observed.session(WCSession.default, didReceiveMessage: snapshot(200, true))
    try? await Task.sleep(nanoseconds: 20_000_000)
    observed.session(WCSession.default, didReceiveMessage: snapshot(201, false))
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(observed.statusMessage == "iPhone reports stopped.", "observed feedback follows subsequent phone state rather than retaining stale success text")
    let restarted = WatchSessionManager()
    restarted.session(WCSession.default, didReceiveMessage: snapshot(300, true, 7))
    restarted.session(WCSession.default, didReceiveMessage: snapshot(301, false, 7))
    restarted.session(WCSession.default, didReceiveMessage: snapshot(302, true, 0))
    restarted.session(WCSession.default, didReceiveMessage: ["type": "mirror", "frame": "Ag==", "ts": 303])
    try? await Task.sleep(nanoseconds: 20_000_000)
    let currentFrame = restarted.lastFrame
    let currentUpdated = restarted.lastUpdated
    expect(currentFrame != nil, "current scan mirror frame is displayed")
    // Delayed data from before Stop must not replace the restarted scan.
    restarted.session(WCSession.default, didReceiveApplicationContext: snapshot(301, false, 7))
    restarted.session(WCSession.default, didReceiveMessage: ["type": "mirror", "frame": "AQ==", "ts": 300])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(restarted.isTracking && restarted.reps == 0, "delayed Stop cannot stop a restarted scan")
    expect(restarted.lastFrame === currentFrame, "delayed old mirror cannot replace the restarted scan frame")
    expect(restarted.lastUpdated == currentUpdated, "rejected old mirror cannot appear as a fresh update")
    for invalidClock: Any in [303, Double.infinity, -1, "invalid"] {
      restarted.session(WCSession.default, didReceiveMessage: ["type": "mirror", "frame": "AQ==", "ts": invalidClock])
    }
    restarted.session(WCSession.default, didReceiveMessage: ["type": "mirror", "frame": "AQ=="])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(restarted.lastFrame === currentFrame && restarted.lastUpdated == currentUpdated, "duplicate, invalid, and unversioned mirrors cannot overwrite an ordered frame")
    restarted.session(WCSession.default, didReceiveMessage: ["type": "session_event", "event": "session_completed", "sessionId": "old-owner-session", "ts": 9999])
    restarted.session(WCSession.default, didReceiveMessage: snapshot(304, false))
    restarted.session(WCSession.default, didReceiveMessage: ["type": "mirror", "frame": "Aw==", "ts": 305])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(!restarted.isTracking && restarted.statusMessage == "iPhone reports stopped.", "workout session events cannot poison scan status ordering")
    expect(restarted.lastFrame != nil && restarted.lastFrame !== currentFrame, "new mirror still displays after rejected stale frames")
    let legacyMirror = WatchSessionManager()
    legacyMirror.session(WCSession.default, didReceiveMessage: ["frame": "AQ=="])
    try? await Task.sleep(nanoseconds: 20_000_000)
    expect(legacyMirror.lastFrame != nil, "unversioned legacy mirror remains supported before an ordered sender")
    await testFrameReceiptFreshness()
    await testPreviewVisibility()
    exit(failures == 0 ? 0 : 1)
  }
}

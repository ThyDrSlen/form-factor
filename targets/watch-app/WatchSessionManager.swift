import Foundation
import SwiftUI
import UIKit
import WatchConnectivity
import Combine

final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
  @Published var lastFrame: UIImage?
  // Local receipt time changes only after a decoded frame passes ordering checks.
  @Published private(set) var lastFrameReceivedAt: Date?
  // Kept separate from frame receipt: a picture is not a tracking report.
  @Published private(set) var lastTrackingReportedAt: Date?
  @Published var lastUpdated: Date?
  @Published var isReachable: Bool = false
  @Published var isTracking: Bool = false
  @Published var reps: Int = 0
  @Published var mode: String?
  @Published var phase: String?
  @Published var primaryCue: String?
  @Published var avgElbowDeg: Double?
  @Published var avgShoulderDeg: Double?
  @Published var headToHand: Double?
  @Published var hipDropRatio: Double?
  @Published var statusMessage: String?
  @Published private(set) var pendingCommand: String?

  private let session: WCSession?
  private var pendingRequestID: UUID?
  private var commandTimeout: DispatchWorkItem?
  // Sender-clock ordering, deliberately independent of mirror-frame timestamps.
  private var lastTrackingTimestamp: Double?
  private var lastFrameTimestamp: Double?
  private var acceptedFrameUptimes: [TimeInterval] = []
  private var hasAcceptedFrame = false

  // Fixed five-second trailing window, including quiet time. Monotonic local
  // receipt times avoid phone clock skew and never count rejected/failed decode.
  func acceptedFrameRate(at uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Double? {
    guard hasAcceptedFrame else { return nil }
    return Double(acceptedFrameUptimes.filter { $0 > uptime - 5 && $0 <= uptime }.count) / 5
  }

  override init() {
    if WCSession.isSupported() {
      session = WCSession.default
    } else {
      session = nil
    }

    super.init()

    session?.delegate = self
    session?.activate()
    isReachable = session?.isReachable ?? false
  }

  #if WATCH_UI_PREVIEW
  // Isolated visual fixture builds only. Never activate WatchConnectivity or
  // send commands to a paired phone from the screenshot harness.
  init(previewOnly: Bool) {
    session = nil
    super.init()
  }

  func receivePreview(_ message: [String: Any]) {
    handleIncoming(message)
  }
  #endif

  // Visibility only: keep legacy image acceptance independent of tracking state.
  func hasFreshFrame(at date: Date) -> Bool {
    guard isReachable, isTracking, lastFrame != nil,
          let receivedAt = lastFrameReceivedAt else { return false }
    let age = date.timeIntervalSince(receivedAt)
    return age >= 0 && age < 3
  }

  func sendCommand(_ command: String) {
    // This is the ephemeral scan-control protocol, not workout Start/Finish.
    guard command == "start" || command == "stop" else { return }
    guard pendingCommand == nil else { return }
    guard let session = session, session.isReachable else {
      statusMessage = "iPhone not reachable — open Form Factor on iPhone."
      return
    }
    let requestID = UUID()
    pendingRequestID = requestID
    pendingCommand = command
    statusMessage = "\(command == "start" ? "Start" : "Stop") requested — waiting for iPhone."
    // A bounded one-shot deadline, not polling or automatic command retry.
    let timeout = DispatchWorkItem { [weak self] in
      guard let self = self, self.pendingRequestID == requestID else { return }
      self.clearPendingCommand()
      self.statusMessage = "No confirmation — check tracking on iPhone before retrying."
    }
    commandTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)
    session.sendMessage(["command": command], replyHandler: nil) { [weak self] error in
      DispatchQueue.main.async {
        guard let self = self, self.pendingRequestID == requestID else { return }
        self.clearPendingCommand()
        self.statusMessage = "Request unconfirmed — \(error.localizedDescription)"
      }
    }
  }

  private func clearPendingCommand() {
    commandTimeout?.cancel()
    commandTimeout = nil
    pendingRequestID = nil
    pendingCommand = nil
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async {
      if let error = error {
        self.statusMessage = error.localizedDescription
      }
      self.isReachable = session.isReachable
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.isReachable = session.isReachable
      if !session.isReachable, self.pendingCommand != nil {
        self.clearPendingCommand()
        self.statusMessage = "Connection lost — check tracking on iPhone."
      }
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handleIncoming(message)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    handleIncoming(applicationContext)
  }

  private func handleIncoming(_ message: [String: Any]) {
    func parseDouble(_ value: Any?) -> Double? {
      if let n = value as? NSNumber { return n.doubleValue }
      if let d = value as? Double { return d }
      if let i = value as? Int { return Double(i) }
      return nil
    }

    DispatchQueue.main.async {
      let hasTracking = message["tracking"] is [String: Any]
        || message["isTracking"] is Bool || message["reps"] is Int
      guard hasTracking else { return }
      let timestamp = parseDouble(message["ts"])
      if let timestamp = timestamp {
        guard timestamp.isFinite, timestamp > 0,
              timestamp > (self.lastTrackingTimestamp ?? -Double.infinity) else { return }
        self.lastTrackingTimestamp = timestamp
      } else {
        // Legacy snapshots remain display-only until an ordered sender is seen.
        guard self.lastTrackingTimestamp == nil, message["ts"] == nil else { return }
      }
      if let tracking = message["tracking"] as? [String: Any] {
        if let isTracking = tracking["isTracking"] as? Bool {
          self.isTracking = isTracking
        } else if let isTracking = message["isTracking"] as? Bool {
          self.isTracking = isTracking
        }

        if let reps = tracking["reps"] as? Int {
          self.reps = reps
        } else if let reps = message["reps"] as? Int {
          self.reps = reps
        }

        if let mode = tracking["mode"] as? String {
          self.mode = mode
        }
        if let phase = tracking["phase"] as? String {
          self.phase = phase
        }
        if let primaryCue = tracking["primaryCue"] as? String {
          self.primaryCue = primaryCue
        } else {
          self.primaryCue = nil
        }

        if let metrics = tracking["metrics"] as? [String: Any] {
          self.avgElbowDeg = parseDouble(metrics["avgElbowDeg"])
          self.avgShoulderDeg = parseDouble(metrics["avgShoulderDeg"])
          self.headToHand = parseDouble(metrics["headToHand"])
          self.hipDropRatio = parseDouble(metrics["hipDropRatio"])
        }

        self.lastUpdated = Date()
      } else {
        if let isTracking = message["isTracking"] as? Bool {
          self.isTracking = isTracking
        }
        if let reps = message["reps"] as? Int {
          self.reps = reps
        }
      }
      let reportedTracking = (message["tracking"] as? [String: Any])?["isTracking"] as? Bool
        ?? message["isTracking"] as? Bool
      if reportedTracking != nil { self.lastTrackingReportedAt = Date() }
      if timestamp != nil, let reportedTracking = reportedTracking,
         self.pendingCommand == nil || reportedTracking == (self.pendingCommand == "start") {
        // Observation only: the legacy phone protocol does not acknowledge IDs.
        self.clearPendingCommand()
        self.statusMessage = reportedTracking ? "iPhone reports tracking." : "iPhone reports stopped."
      }
    }

    if let frame = message["frame"] as? String {
      let timestamp = parseDouble(message["ts"])
      DispatchQueue.global(qos: .userInitiated).async {
        if let data = Data(base64Encoded: frame, options: .ignoreUnknownCharacters),
           let image = UIImage(data: data) {
          DispatchQueue.main.async {
            // Decode completions can arrive out of order too. Keep this clock
            // separate so mirror traffic cannot suppress tracking Stop/status.
            if let timestamp = timestamp {
              guard timestamp.isFinite, timestamp > 0,
                    timestamp > (self.lastFrameTimestamp ?? -Double.infinity) else { return }
              self.lastFrameTimestamp = timestamp
            } else {
              guard self.lastFrameTimestamp == nil, message["ts"] == nil else { return }
            }
            self.lastFrame = image
            let receivedAt = Date()
            self.lastFrameReceivedAt = receivedAt
            let uptime = ProcessInfo.processInfo.systemUptime
            self.acceptedFrameUptimes.removeAll { $0 <= uptime - 5 }
            self.acceptedFrameUptimes.append(uptime)
            self.hasAcceptedFrame = true
            self.lastUpdated = receivedAt
          }
        }
      }
    }
  }
}

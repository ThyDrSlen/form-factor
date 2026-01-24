import Foundation
import SwiftUI
import UIKit
import WatchConnectivity
import Combine

final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
  @Published var lastFrame: UIImage?
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

  private let session: WCSession?

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

  func sendCommand(_ command: String) {
    guard let session = session, session.isReachable else { return }
    session.sendMessage(["command": command], replyHandler: nil) { [weak self] error in
      DispatchQueue.main.async {
        self?.statusMessage = error.localizedDescription
      }
    }
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
        self.statusMessage = nil
      } else {
        if let isTracking = message["isTracking"] as? Bool {
          self.isTracking = isTracking
        }
        if let reps = message["reps"] as? Int {
          self.reps = reps
        }
      }
    }

    if let frame = message["frame"] as? String {
      DispatchQueue.global(qos: .userInitiated).async {
        if let data = Data(base64Encoded: frame, options: .ignoreUnknownCharacters),
           let image = UIImage(data: data) {
          DispatchQueue.main.async {
            self.lastFrame = image
            self.lastUpdated = Date()
            self.statusMessage = nil
          }
        }
      }
    }
  }
}

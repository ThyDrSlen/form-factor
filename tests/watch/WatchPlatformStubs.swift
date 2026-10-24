import Foundation

protocol ObservableObject {}
protocol WCSessionDelegate: AnyObject {}
enum WCSessionActivationState { case activated }
final class UIImage {
  // Synthetic nonempty image fixtures remain supported; empty data fails decode.
  init?(data: Data) {
    guard !data.isEmpty else { return nil }
  }
}
final class WCSession {
  static let `default` = WCSession()
  static func isSupported() -> Bool { true }
  weak var delegate: WCSessionDelegate?
  var isReachable = false
  var messages: [[String: Any]] = []
  var failures: [(Error) -> Void] = []
  func activate() {}
  func sendMessage(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)?, errorHandler: ((Error) -> Void)?) {
    messages.append(message)
    if let errorHandler { failures.append(errorHandler) }
  }
  func reset() {
    isReachable = false
    messages = []
    failures = []
  }
}

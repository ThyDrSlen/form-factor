import ExpoModulesCore
import Foundation
import WatchConnectivity

private final class FFWatchSessionDelegateProxy: NSObject, WCSessionDelegate {
  weak var owner: FFWatchConnectivityModule?

  init(owner: FFWatchConnectivityModule) {
    self.owner = owner
    super.init()
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    owner?.handleActivationDidComplete(session: session, activationState: activationState, error: error)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    owner?.handleReachabilityDidChange(session: session)
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    owner?.handleWatchStateDidChange(session: session)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    owner?.handleDidReceiveMessage(message)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    owner?.handleDidReceiveApplicationContext(applicationContext)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    owner?.handleDidDeactivate(session: session)
  }
}

public final class FFWatchConnectivityModule: Module {
  private let session: WCSession? = WCSession.isSupported() ? WCSession.default : nil
  private let moduleEventPrefix = "FFWatchConnectivity"
  private lazy var delegateProxy = FFWatchSessionDelegateProxy(owner: self)

  private var eventMessage: String { "\(moduleEventPrefix).message" }
  private var eventReachability: String { "\(moduleEventPrefix).reachability" }
  private var eventPaired: String { "\(moduleEventPrefix).paired" }
  private var eventInstalled: String { "\(moduleEventPrefix).installed" }

  public func definition() -> ModuleDefinition {
    Name("FFWatchConnectivity")
    Events(eventMessage, eventReachability, eventPaired, eventInstalled)

    OnCreate {
      self.session?.delegate = self.delegateProxy
      self.session?.activate()
      self.emitStatus()
    }

    Function("sendMessage") { (payload: [String: Any]) in
      guard let session = self.session, session.isReachable else { return }
      session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
    }

    Function("updateApplicationContext") { (context: [String: Any]) in
      guard let session = self.session else { return }
      do {
        try session.updateApplicationContext(context)
      } catch {
        // best-effort
      }
    }

    AsyncFunction("getReachability") { (promise: Promise) in
      promise.resolve(self.session?.isReachable ?? false)
    }

    AsyncFunction("getIsPaired") { (promise: Promise) in
      promise.resolve(self.session?.isPaired ?? false)
    }

    AsyncFunction("getIsWatchAppInstalled") { (promise: Promise) in
      promise.resolve(self.session?.isWatchAppInstalled ?? false)
    }
  }

  private func emitStatus() {
    guard let session = session else { return }
    DispatchQueue.main.async {
      self.sendEvent(self.eventReachability, ["reachable": session.isReachable])
      self.sendEvent(self.eventPaired, ["paired": session.isPaired])
      self.sendEvent(self.eventInstalled, ["installed": session.isWatchAppInstalled])
    }
  }

  fileprivate func handleActivationDidComplete(
    session: WCSession,
    activationState: WCSessionActivationState,
    error: Error?
  ) {
    emitStatus()
  }

  fileprivate func handleReachabilityDidChange(session: WCSession) {
    DispatchQueue.main.async {
      self.sendEvent(self.eventReachability, ["reachable": session.isReachable])
    }
  }

  fileprivate func handleWatchStateDidChange(session: WCSession) {
    DispatchQueue.main.async {
      self.sendEvent(self.eventPaired, ["paired": session.isPaired])
      self.sendEvent(self.eventInstalled, ["installed": session.isWatchAppInstalled])
    }
  }

  fileprivate func handleDidReceiveMessage(_ message: [String: Any]) {
    DispatchQueue.main.async {
      self.sendEvent(self.eventMessage, message)
    }
  }

  fileprivate func handleDidReceiveApplicationContext(_ applicationContext: [String: Any]) {
    DispatchQueue.main.async {
      self.sendEvent(self.eventMessage, applicationContext)
    }
  }

  fileprivate func handleDidDeactivate(session: WCSession) {
    session.activate()
    emitStatus()
  }
}

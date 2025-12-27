import SwiftUI

@main
struct FormFactorWatchApp: App {
  @StateObject private var watchSession = WatchSessionManager()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(watchSession)
    }
  }
}

import SwiftUI
import UIKit

struct ContentView: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    VStack(spacing: 6) {
      ZStack {
        if let frame = session.lastFrame {
          Image(uiImage: frame)
            .resizable()
            .scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        } else {
          VStack(spacing: 6) {
            Image(systemName: "video")
              .font(.system(size: 20, weight: .semibold))
            Text(session.isReachable ? "Waiting for mirror" : "iPhone not reachable")
              .font(.caption2)
              .multilineTextAlignment(.center)
          }
          .foregroundColor(.secondary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color.black.opacity(0.15))
          .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      HStack(spacing: 6) {
        Button("Start") {
          session.sendCommand("start")
        }
        .buttonStyle(.borderedProminent)

        Button("Stop") {
          session.sendCommand("stop")
        }
        .buttonStyle(.bordered)
      }
      .font(.caption2)

      HStack(spacing: 6) {
        Circle()
          .fill(session.isTracking ? Color.green : Color.gray)
          .frame(width: 6, height: 6)
        Text(session.isTracking ? "Tracking" : "Idle")
        if session.reps > 0 {
          Text("• \(session.reps) reps")
        }
      }
      .font(.caption2)

      if let updated = session.lastUpdated {
        Text(updated, style: .time)
          .font(.caption2)
          .foregroundColor(.secondary)
      } else if let status = session.statusMessage {
        Text(status)
          .font(.caption2)
          .foregroundColor(.secondary)
          .lineLimit(1)
      }
    }
    .padding(8)
  }
}

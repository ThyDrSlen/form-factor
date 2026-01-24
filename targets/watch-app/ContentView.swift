import SwiftUI
import UIKit

struct ContentView: View {
  var body: some View {
    TabView {
      MirrorScreen()
      MetricsScreen()
    }
    .tabViewStyle(.page)
  }
}

private struct MirrorScreen: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    VStack(spacing: 6) {
      ZStack(alignment: .topLeading) {
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

        VStack(alignment: .leading, spacing: 2) {
          Text("\(session.reps)")
            .font(.system(size: 26, weight: .bold, design: .rounded))
          if let phase = session.phase, !phase.isEmpty {
            Text(phase.uppercased())
              .font(.caption2)
              .foregroundColor(.secondary)
          }
          if let cue = session.primaryCue, !cue.isEmpty {
            Text(cue)
              .font(.caption2)
              .lineLimit(2)
          }
        }
        .padding(6)
        .background(Color.black.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .padding(6)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      ControlsRow()
      StatusRow()
      UpdatedRow()
    }
    .padding(8)
  }
}

private struct MetricsScreen: View {
  @EnvironmentObject private var session: WatchSessionManager

  private func formatAngle(_ value: Double?) -> String? {
    guard let value = value else { return nil }
    return String(format: "%.1f°", value)
  }

  private func formatPercent(_ value: Double?) -> String? {
    guard let value = value else { return nil }
    return "\(Int((value * 100.0).rounded()))%"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      VStack(alignment: .leading, spacing: 2) {
        if let mode = session.mode, !mode.isEmpty {
          Text(mode.uppercased())
            .font(.caption2)
            .foregroundColor(.secondary)
        }
        Text("\(session.reps) reps")
          .font(.system(size: 22, weight: .bold, design: .rounded))
        if let phase = session.phase, !phase.isEmpty {
          Text("Phase: \(phase)")
            .font(.caption2)
        }
        if let cue = session.primaryCue, !cue.isEmpty {
          Text(cue)
            .font(.caption2)
            .lineLimit(3)
        }
      }

      VStack(alignment: .leading, spacing: 2) {
        if let elbow = formatAngle(session.avgElbowDeg) {
          Text("Avg elbow: \(elbow)")
            .font(.caption2)
        }
        if let shoulder = formatAngle(session.avgShoulderDeg) {
          Text("Avg shoulder: \(shoulder)")
            .font(.caption2)
        }
        if let headToHand = session.headToHand {
          Text(String(format: "Head→hand: %.2f", headToHand))
            .font(.caption2)
        }
        if let hip = formatPercent(session.hipDropRatio) {
          Text("Hip drop: \(hip)")
            .font(.caption2)
        }
      }

      Spacer(minLength: 0)

      ControlsRow()
      StatusRow()
      UpdatedRow()
    }
    .padding(8)
  }
}

private struct ControlsRow: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
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
  }
}

private struct StatusRow: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(session.isTracking ? Color.green : Color.gray)
        .frame(width: 6, height: 6)
      Text(session.isTracking ? "Tracking" : "Idle")
      if !session.isReachable {
        Text("• not reachable")
          .foregroundColor(.secondary)
      }
    }
    .font(.caption2)
  }
}

private struct UpdatedRow: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
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
}

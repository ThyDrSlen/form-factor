import SwiftUI
import UIKit

struct ContentView: View {
  @State private var selectedPage = 0

  init() {}

  #if WATCH_UI_PREVIEW
  init(previewPage: Int) {
    _selectedPage = State(initialValue: previewPage)
  }
  #endif

  var body: some View {
    TabView(selection: $selectedPage) {
      MirrorScreen().tag(0)
      CurrentSetScreen().tag(1)
      TrackingHealthScreen().tag(2)
    }
    // Both Watch targets deploy to watchOS 10. Crown/swipe navigation is native.
    // Selection is local: incoming phone state must never move the mirror away.
    .tabViewStyle(.verticalPage)
    .containerBackground(.black, for: .tabView)
  }
}

private struct MirrorScreen: View {
  @EnvironmentObject private var session: WatchSessionManager
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var controlsVisible = false
  @State private var controlsRevision = 0

  #if WATCH_UI_PREVIEW
  init() {
    _controlsVisible = State(initialValue: ProcessInfo.processInfo.environment["WATCH_PREVIEW_CONTROLS"] == "1")
  }
  #endif

  var body: some View {
    TimelineView(.periodic(from: .now, by: 0.5)) { context in
      let now = max(context.date, Date())
      let fresh = session.hasFreshFrame(at: now)

      ZStack {
        // Only the image ignores safe areas. Buttons and labels retain the
        // system insets, so neither rounded corners nor the clock hide them.
        GeometryReader { geometry in
          ZStack {
            Color.black
            if fresh, let frame = session.lastFrame {
              Image(uiImage: frame)
                .resizable()
                .scaledToFit()
                .frame(width: geometry.size.width, height: geometry.size.height)
            }
          }
          .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { revealControls() }
        .accessibilityLabel("Camera mirror, sampled preview")
        .accessibilityHint("Double tap to show camera controls")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { revealControls() }

        if !fresh && !controlsVisible {
          VStack(spacing: 8) {
            Image(systemName: "video.slash")
              .font(.title2)
            Text(pausedTitle).font(.headline)
            Text(pausedDetail)
              .font(.caption2)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
            Button("Camera controls") { revealControls() }
              .font(.caption)
          }
          .multilineTextAlignment(.center)
          .padding(.horizontal, 14)
        }

        if controlsVisible {
          ScrollView {
            VStack(spacing: 8) {
              HStack {
                Text("Camera mirror").font(.caption)
                Spacer(minLength: 0)
                Button { controlsVisible = false } label: {
                  Image(systemName: "xmark").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Hide controls")
              }
              CameraControl()
              Text("Full frame · no crop")
                .font(.caption2).foregroundStyle(.secondary)
              CommandFeedback(includeTrackingReport: false)
            }
            .padding(10)
          }
          .background(.black.opacity(0.88), in: RoundedRectangle(cornerRadius: 18))
          .padding(.horizontal, 8)
          .transition(.opacity)
        } else if fresh {
          VStack {
            Spacer()
            Text("SAMPLED")
              .font(.system(size: 9, weight: .medium, design: .rounded))
              .tracking(1)
              .padding(.horizontal, 6)
              .padding(.vertical, 3)
              .background(.black.opacity(0.6), in: Capsule())
          }
          .allowsHitTesting(false)
        }
      }
    }
    .task(id: controlsRevision) {
      guard controlsVisible else { return }
      try? await Task.sleep(nanoseconds: 6_000_000_000)
      guard !Task.isCancelled, session.pendingCommand == nil else { return }
      withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
        controlsVisible = false
      }
    }
    .onChange(of: session.pendingCommand) { _, _ in
      if controlsVisible { controlsRevision += 1 }
    }
    .onChange(of: session.statusMessage) { _, _ in
      if controlsVisible { controlsRevision += 1 }
    }
    .onDisappear { controlsVisible = false }
  }

  private func revealControls() {
    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
      controlsVisible = true
    }
    controlsRevision += 1
  }

  private var pausedTitle: String {
    if !session.isReachable { return "iPhone unreachable" }
    if !session.isTracking { return "Camera paused" }
    return session.lastFrameReceivedAt == nil ? "Waiting for preview" : "Preview is stale"
  }

  private var pausedDetail: String {
    if !session.isReachable { return "Open Form Factor on your iPhone." }
    if !session.isTracking { return "Start the camera when you're ready." }
    return "No fresh frame. Check the camera on iPhone."
  }
}

private struct CurrentSetScreen: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        Text("CURRENT SET")
          .font(.caption2).foregroundStyle(.secondary)
        HStack(alignment: .center, spacing: 10) {
          VStack(alignment: .leading, spacing: 0) {
            Text(session.lastTrackingReportedAt == nil ? "–" : "\(session.reps)")
              .font(.system(size: 42, weight: .semibold, design: .rounded))
              .monospacedDigit()
            Text("reps").font(.caption2).foregroundStyle(.secondary)
          }
          VStack(alignment: .leading, spacing: 3) {
            Text(exerciseName).font(.headline)
            Text(phaseName).font(.caption2).foregroundStyle(.secondary)
          }
          Spacer(minLength: 0)
        }
        if let cue = nonempty(session.primaryCue) {
          Text(cue).font(.headline)
            .foregroundStyle(.mint)
            .fixedSize(horizontal: false, vertical: true)
        } else {
          Text("No coaching cue from iPhone")
            .font(.caption2).foregroundStyle(.secondary)
        }
        if !session.isReachable || !session.isTracking {
          Text("Last reported set")
            .font(.caption2).foregroundStyle(.secondary)
        }
        CameraControl()
        CommandFeedback()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 12)
      .padding(.bottom, 12)
    }
  }

  private var exerciseName: String {
    guard let mode = nonempty(session.mode) else { return "Exercise unavailable" }
    let names = ["pullup": "Pull-up", "pushup": "Push-up", "rdl": "Romanian deadlift"]
    return names[mode.lowercased()] ?? readable(mode)
  }

  private var phaseName: String {
    guard let phase = nonempty(session.phase) else { return "Phase unavailable" }
    switch phase.lowercased() {
    case "setup": return "Getting into position"
    case "idle": return "Ready"
    case "eccentric", "descent", "lowering": return "Lowering"
    case "concentric", "ascent": return "Lifting"
    case "top": return "At the top"
    case "bottom": return "At the bottom"
    default: return readable(phase)
    }
  }
}

private struct TrackingHealthScreen: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    TimelineView(.periodic(from: .now, by: 0.5)) { context in
      let now = max(context.date, Date())
      ScrollView {
        VStack(alignment: .leading, spacing: 7) {
          Text("TRACKING HEALTH")
            .font(.caption2).foregroundStyle(.secondary)
          VStack(alignment: .leading, spacing: 2) {
            Text(session.acceptedFrameRate().map { String(format: "%.1f fps", $0) } ?? "Unavailable")
              .font(.system(.title2, design: .rounded, weight: .semibold))
              .monospacedDigit()
            Text("Received · last 5 s")
              .font(.caption2).foregroundStyle(.secondary)
          }
          Divider()
          HealthRow(title: "Frame age", value: age(session.lastFrameReceivedAt, at: now))
          HealthRow(title: "iPhone", value: session.isReachable ? "Reachable" : "Unreachable")
          HealthRow(title: "Phone reports", value: trackingReport)
          HealthRow(title: "Report age", value: age(session.lastTrackingReportedAt, at: now))
          Text("Sampled preview, nominal 2 fps. Not full-rate video.")
            .font(.caption2).foregroundStyle(.secondary)
          Text("Counts decoded, accepted frames on this Watch. Body confidence is unavailable.")
            .font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
      }
    }
  }

  private var trackingReport: String {
    guard session.lastTrackingReportedAt != nil else { return "Unavailable" }
    return session.isTracking ? "Tracking" : "Stopped"
  }

  private func age(_ date: Date?, at now: Date) -> String {
    guard let date else { return "Unavailable" }
    let seconds = max(0, now.timeIntervalSince(date))
    return seconds < 60 ? String(format: "%.1f s", seconds) : String(format: "%.0f min", seconds / 60)
  }
}

private struct HealthRow: View {
  let title: String
  let value: String

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).foregroundStyle(.secondary)
      Spacer(minLength: 6)
      Text(value).multilineTextAlignment(.trailing).monospacedDigit()
    }
    .font(.caption2)
  }
}

private struct CameraControl: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    Button {
      session.sendCommand(session.isTracking ? "stop" : "start")
    } label: {
      HStack(spacing: 6) {
        if session.pendingCommand != nil { ProgressView().controlSize(.mini) }
        Text(label)
      }
      .frame(maxWidth: .infinity, minHeight: 30)
    }
    .font(.caption)
    .buttonStyle(.bordered)
    .tint(session.isTracking ? .gray : .mint)
    .disabled(session.pendingCommand != nil)
  }

  private var label: String {
    if let pending = session.pendingCommand {
      return pending == "start" ? "Starting camera…" : "Stopping camera…"
    }
    return session.isTracking ? "Stop camera" : "Start camera"
  }
}

private struct CommandFeedback: View {
  @EnvironmentObject private var session: WatchSessionManager
  var includeTrackingReport = true

  var body: some View {
    if let status = session.statusMessage,
       includeTrackingReport || (status != "iPhone reports tracking." && status != "iPhone reports stopped.") {
      Text(status)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    } else if !session.isReachable {
      Text("Open Form Factor on iPhone to connect.")
        .font(.caption2).foregroundStyle(.secondary)
    }
  }
}

private func nonempty(_ value: String?) -> String? {
  guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
  return value
}

private func readable(_ value: String) -> String {
  value.replacingOccurrences(of: "_", with: " ")
    .replacingOccurrences(of: "-", with: " ").capitalized
}

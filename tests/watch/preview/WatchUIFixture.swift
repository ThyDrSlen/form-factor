#if WATCH_UI_PREVIEW
import SwiftUI
import UIKit
import Combine

// Separate simulator-only app, compiled with the production Watch UI/manager.
// All numbers and the framing chart are simulated, not observations of a phone.
@main
struct WatchUIFixture: App {
  @StateObject private var session = WatchSessionManager(previewOnly: true)
  private let timer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
  private let frame = fixtureFrame()

  var body: some Scene {
    WindowGroup {
      ContentView(previewPage: Int(ProcessInfo.processInfo.environment["WATCH_PREVIEW_PAGE"] ?? "0") ?? 0)
        .environmentObject(session)
        .overlay(alignment: .topLeading) {
          Text("SIMULATED")
            .font(.system(size: 8, weight: .bold))
            .padding(3)
            .background(.black)
            .foregroundStyle(.yellow)
            .offset(x: 10, y: -34)
            .allowsHitTesting(false)
        }
        .onReceive(timer) { now in
          guard ProcessInfo.processInfo.environment["WATCH_PREVIEW_EMPTY"] != "1" else { return }
          session.isReachable = true
          session.receivePreview([
            "ts": now.timeIntervalSince1970 * 1000,
            "tracking": ["isTracking": true, "mode": "squat", "phase": "descent",
                         "reps": 8, "primaryCue": "Keep your chest up"],
            "frame": frame
          ])
        }
    }
  }
}

// A deliberately schematic portrait framing chart. Its border demonstrates
// full-frame fit without pretending to be a captured human or live skeleton.
private func fixtureFrame() -> String {
  let width = 360, height = 640
  let context = CGContext(data: nil, width: width, height: height,
                          bitsPerComponent: 8, bytesPerRow: width * 4,
                          space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.setFillColor(UIColor(white: 0.09, alpha: 1).cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.setStrokeColor(UIColor(white: 0.2, alpha: 1).cgColor)
  context.setLineWidth(1)
  for x in stride(from: 0, through: width, by: 40) {
    context.move(to: CGPoint(x: x, y: 0)); context.addLine(to: CGPoint(x: x, y: height))
  }
  for y in stride(from: 0, through: height, by: 40) {
    context.move(to: CGPoint(x: 0, y: y)); context.addLine(to: CGPoint(x: width, y: y))
  }
  context.strokePath()
  context.setStrokeColor(UIColor(red: 0.4, green: 0.9, blue: 0.8, alpha: 1).cgColor)
  context.setLineWidth(4)
  context.stroke(CGRect(x: 3, y: 3, width: width - 6, height: height - 6))
  context.strokeEllipse(in: CGRect(x: 155, y: 475, width: 50, height: 50))
  let lines: [[CGPoint]] = [
    [CGPoint(x: 180, y: 475), CGPoint(x: 180, y: 420), CGPoint(x: 205, y: 295)],
    [CGPoint(x: 90, y: 330), CGPoint(x: 120, y: 405), CGPoint(x: 180, y: 420), CGPoint(x: 245, y: 400), CGPoint(x: 280, y: 330)],
    [CGPoint(x: 205, y: 295), CGPoint(x: 125, y: 210), CGPoint(x: 100, y: 80)],
    [CGPoint(x: 205, y: 295), CGPoint(x: 275, y: 210), CGPoint(x: 285, y: 80)]
  ]
  context.setLineWidth(6)
  for line in lines {
    context.addLines(between: line); context.strokePath()
    for point in line {
      context.setFillColor(UIColor.white.cgColor)
      context.fillEllipse(in: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10))
    }
  }
  return UIImage(cgImage: context.makeImage()!).jpegData(compressionQuality: 0.9)!.base64EncodedString()
}
#endif
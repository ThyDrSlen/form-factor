import ExpoModulesCore
import ARKit
import RealityKit
import UIKit
import AVFoundation
import CoreImage
import ImageIO
import QuartzCore
#if canImport(MediaPipeTasksVision)
import MediaPipeTasksVision
#endif

// Represents a 3D joint with position and tracking state
public struct Joint3D: Record {
  @Field var name: String = ""
  @Field var x: Double = 0.0 // Meters in world space
  @Field var y: Double = 0.0 // Meters in world space
  @Field var z: Double = 0.0 // Meters in world space
  @Field var isTracked: Bool = false

  public init() {}

  public init(name: String, x: Double, y: Double, z: Double, isTracked: Bool) {
    self.name = name
    self.x = x
    self.y = y
    self.z = z
    self.isTracked = isTracked
  }
}

// 2D joint projected into view space (normalized 0..1)
public struct Joint2D: Record {
  @Field var name: String = ""
  @Field var x: Double = 0.0 // 0..1 in view space
  @Field var y: Double = 0.0 // 0..1 in view space (origin top-left)
  @Field var isTracked: Bool = false

  public init() {}

  public init(name: String, x: Double, y: Double, isTracked: Bool) {
    self.name = name
    self.x = x
    self.y = y
    self.isTracked = isTracked
  }
}

public struct BodyPose2D: Record {
  @Field var joints: [Joint2D] = []
  @Field var timestamp: Double = 0.0
  @Field var isTracking: Bool = false

  public init() {}

  public init(joints: [Joint2D], timestamp: Double, isTracking: Bool) {
    self.joints = joints
    self.timestamp = timestamp
    self.isTracking = isTracking
  }
}

// Body pose data with joints and metadata
public struct BodyPose: Record {
  @Field var joints: [Joint3D] = []
  @Field var timestamp: Double = 0.0
  @Field var isTracking: Bool = false
  @Field var estimatedHeight: Double? = nil

  public init() {}

  public init(joints: [Joint3D], timestamp: Double, isTracking: Bool, estimatedHeight: Double?) {
    self.joints = joints
    self.timestamp = timestamp
    self.isTracking = isTracking
    self.estimatedHeight = estimatedHeight
  }
}

fileprivate struct RecordingPreset {
  let maxDimension: CGFloat
  let maxFps: Int
  let minBitrate: Int
  let maxBitrate: Int
  let bitsPerPixel: CGFloat
}

fileprivate func recordingPreset(for quality: String?) -> RecordingPreset {
  switch quality?.lowercased() {
  case "low":
    return RecordingPreset(
      maxDimension: 1080,
      maxFps: 30,
      minBitrate: 1_500_000,
      maxBitrate: 3_500_000,
      bitsPerPixel: 0.07
    )
  case "high":
    return RecordingPreset(
      maxDimension: 1920,
      maxFps: 30,
      minBitrate: 4_000_000,
      maxBitrate: 8_000_000,
      bitsPerPixel: 0.09
    )
  default:
    return RecordingPreset(
      maxDimension: 1440,
      maxFps: 30,
      minBitrate: 2_500_000,
      maxBitrate: 5_500_000,
      bitsPerPixel: 0.08
    )
  }
}

public class ARKitBodyTrackerModule: Module {
  private var arSession: ARSession?
  fileprivate(set) var currentBodyAnchor: ARBodyAnchor?
  fileprivate(set) var isRunning = false
  private lazy var sessionDelegate = ARKitSessionDelegate(owner: self)
  // If an ARKitBodyView is mounted, it will set this reference so we can drive its session
  public static var sharedARView: ARView?
  fileprivate let videoRecorder = ARVideoRecorder()
  private let ciContext = CIContext(options: nil)
  fileprivate let sessionMaxDimension: CGFloat = 1920
  fileprivate let sessionMaxFps: Int = 30
  fileprivate var subjectLockEnabled = true
  fileprivate var lockedBodyAnchorId: UUID?
  fileprivate var lockedBodyAnchorLastSeenTs: TimeInterval = 0
  fileprivate var lockedMissingCount = 0
  fileprivate let subjectLockTimeout: TimeInterval = 4.0
  fileprivate(set) var mediaPipeModelVersion = "mediapipe-pose-landmarker@0.1.0"
#if canImport(MediaPipeTasksVision)
  fileprivate var mediaPipePoseLandmarker: PoseLandmarker?
  fileprivate var mediaPipeModelPath: String?
#endif

  fileprivate func computePose2DJoints(
    frame: ARFrame,
    bodyAnchor: ARBodyAnchor,
    arView: ARView
  ) -> [Joint2D]? {
    guard bodyAnchor.isTracked else {
      return nil
    }

    let viewW = Double(arView.bounds.width)
    let viewH = Double(arView.bounds.height)
    if viewW <= 0 || viewH <= 0 {
      return nil
    }

    let skeleton = bodyAnchor.skeleton
    var joints2D: [Joint2D] = []

    let preferredJointNamesRaw: [String] = [
      "root",
      "hips_joint",
      "spine_1_joint","spine_2_joint","spine_3_joint","spine_4_joint","spine_5_joint","spine_6_joint","spine_7_joint",
      "neck_1_joint","neck_2_joint","neck_3_joint","neck_4_joint","head_joint",
      "left_shoulder_1_joint","left_arm_joint","left_forearm_joint","left_hand_joint",
      "right_shoulder_1_joint","right_arm_joint","right_forearm_joint","right_hand_joint",
      "left_upLeg_joint","left_leg_joint","left_foot_joint",
      "right_upLeg_joint","right_leg_joint","right_foot_joint"
    ]

    let availableRaw = Set(skeleton.definition.jointNames)
    let jointNames: [ARSkeleton.JointName] = preferredJointNamesRaw
      .filter { availableRaw.contains($0) }
      .map { ARSkeleton.JointName(rawValue: $0) }

    for jointName in jointNames {
      guard let jointModel = skeleton.modelTransform(for: jointName) else { continue }
      let worldTransform = simd_mul(bodyAnchor.transform, jointModel)
      let p = worldTransform.columns.3
      let worldPoint = SIMD3<Float>(p.x, p.y, p.z)
      if let projected = self.projectJointPoint(worldPoint, arView: arView, frame: frame) {
        let nx = max(0.0, min(1.0, Double(projected.x) / viewW))
        let ny = max(0.0, min(1.0, Double(projected.y) / viewH))
        let idx = skeleton.definition.index(for: jointName)
        let tracked = skeleton.isJointTracked(idx)
        joints2D.append(Joint2D(
          name: jointName.rawValue,
          x: nx,
          y: ny,
          isTracked: tracked
        ))
      }
    }

    return joints2D
  }

  fileprivate func currentInterfaceOrientation(for view: UIView) -> UIInterfaceOrientation {
    if let orientation = view.window?.windowScene?.interfaceOrientation {
      return orientation
    }
    return .portrait
  }

  private func imageOrientation(for view: UIView?) -> CGImagePropertyOrientation {
    guard let view = view else {
      return .right
    }
    switch currentInterfaceOrientation(for: view) {
    case .portrait:
      return .right
    case .portraitUpsideDown:
      return .left
    case .landscapeLeft:
      return .up
    case .landscapeRight:
      return .down
    default:
      return .right
    }
  }

  private func makeSnapshotPayload(maxWidth: CGFloat, quality: CGFloat) -> [String: Any]? {
    let activeSession = self.arSession ?? ARKitBodyTrackerModule.sharedARView?.session
    guard let frame = activeSession?.currentFrame else {
      return nil
    }

    let ciImage = CIImage(cvPixelBuffer: frame.capturedImage)
    let oriented = ciImage.oriented(imageOrientation(for: ARKitBodyTrackerModule.sharedARView))
    if oriented.extent.width <= 0 || oriented.extent.height <= 0 {
      return nil
    }
    let clampedMaxWidth = maxWidth > 0 ? maxWidth : oriented.extent.width
    let scale = min(1.0, clampedMaxWidth / oriented.extent.width)
    let scaledImage = oriented.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

    guard let cgImage = ciContext.createCGImage(scaledImage, from: scaledImage.extent) else {
      return nil
    }

    let clampedQuality = max(0.05, min(1.0, quality))
    let image = UIImage(cgImage: cgImage)
    guard let data = image.jpegData(compressionQuality: clampedQuality) else {
      return nil
    }

    return [
      "frame": data.base64EncodedString(),
      "width": Int(scaledImage.extent.width),
      "height": Int(scaledImage.extent.height),
      "orientation": "up",
      "mirrored": false
    ]
  }

  private func resolveMediaPipeModelPath(explicitModelPath: String?, modelName: String?) -> String? {
    if let explicitModelPath {
      let trimmed = explicitModelPath.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty {
        let normalizedPath: String
        if trimmed.hasPrefix("file://"), let fileUrl = URL(string: trimmed), fileUrl.isFileURL {
          normalizedPath = fileUrl.path
        } else {
          normalizedPath = trimmed
        }

        if FileManager.default.fileExists(atPath: normalizedPath) {
          return normalizedPath
        }
      }
    }

    let candidates = [
      modelName,
      "pose_landmarker_lite",
      "pose_landmarker_full",
      "pose_landmarker_heavy"
    ].compactMap { name -> String? in
      guard let name, !name.isEmpty else { return nil }
      return name
    }

    for candidate in candidates {
      if let bundledPath = Bundle.main.path(forResource: candidate, ofType: "task") {
        return bundledPath
      }
    }

    return nil
  }

#if canImport(MediaPipeTasksVision)
  private func configureMediaPipePoseLandmarker(options: [String: Any]?) -> Bool {
    let explicitModelPath = options?["modelPath"] as? String
    let modelName = options?["modelName"] as? String
    let modelVersion = (options?["modelVersion"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let minPoseDetectionConfidence = Float(options?["minPoseDetectionConfidence"] as? Double ?? 0.5)
    let minPosePresenceConfidence = Float(options?["minPosePresenceConfidence"] as? Double ?? 0.5)
    let minTrackingConfidence = Float(options?["minTrackingConfidence"] as? Double ?? 0.5)
    let numPoses = max(1, options?["numPoses"] as? Int ?? 1)

    guard let resolvedModelPath = resolveMediaPipeModelPath(explicitModelPath: explicitModelPath, modelName: modelName) else {
      print("[ARKit][MediaPipe] Model file not found. Expected explicit modelPath or bundled *.task model.")
      mediaPipePoseLandmarker = nil
      mediaPipeModelPath = nil
      return false
    }

    do {
      let poseLandmarkerOptions = PoseLandmarkerOptions()
      poseLandmarkerOptions.runningMode = .image
      poseLandmarkerOptions.numPoses = numPoses
      poseLandmarkerOptions.minPoseDetectionConfidence = minPoseDetectionConfidence
      poseLandmarkerOptions.minPosePresenceConfidence = minPosePresenceConfidence
      poseLandmarkerOptions.minTrackingConfidence = minTrackingConfidence
      poseLandmarkerOptions.baseOptions.modelAssetPath = resolvedModelPath

      mediaPipePoseLandmarker = try PoseLandmarker(options: poseLandmarkerOptions)
      mediaPipeModelPath = resolvedModelPath
      if let modelVersion, !modelVersion.isEmpty {
        mediaPipeModelVersion = modelVersion
      }

      print("[ARKit][MediaPipe] Pose landmarker configured with model: \(resolvedModelPath)")
      return true
    } catch {
      print("[ARKit][MediaPipe] Failed to initialize PoseLandmarker: \(error.localizedDescription)")
      mediaPipePoseLandmarker = nil
      mediaPipeModelPath = nil
      return false
    }
  }

  private func currentMediaPipePose2DPayload() -> [String: Any]? {
    guard let poseLandmarker = mediaPipePoseLandmarker else {
      return nil
    }

    let activeSession = arSession ?? ARKitBodyTrackerModule.sharedARView?.session
    guard let frame = activeSession?.currentFrame else {
      return nil
    }

    let ciImage = CIImage(cvPixelBuffer: frame.capturedImage)
    let oriented = ciImage.oriented(imageOrientation(for: ARKitBodyTrackerModule.sharedARView))
    guard let cgImage = ciContext.createCGImage(oriented, from: oriented.extent) else {
      return nil
    }

    let uiImage = UIImage(cgImage: cgImage)
    guard let image = try? MPImage(uiImage: uiImage) else {
      return nil
    }

    let started = CACurrentMediaTime()
    do {
      let result = try poseLandmarker.detect(image: image)
      guard let firstPoseLandmarks = result.landmarks.first,
            !firstPoseLandmarks.isEmpty else {
        return nil
      }

      let inferenceMs = (CACurrentMediaTime() - started) * 1000
      let serialized = firstPoseLandmarks.map { landmark -> [String: Any] in
        var payload: [String: Any] = [
          "x": Double(landmark.x),
          "y": Double(landmark.y)
        ]
        if let visibility = landmark.visibility {
          payload["visibility"] = Double(visibility)
        }
        if let presence = landmark.presence {
          payload["presence"] = Double(presence)
        }
        return payload
      }

      return [
        "landmarks": serialized,
        "timestamp": frame.timestamp,
        "inferenceMs": inferenceMs,
        "poseCount": result.landmarks.count,
        "modelVersion": mediaPipeModelVersion,
      ]
    } catch {
      print("[ARKit][MediaPipe] detect failed: \(error.localizedDescription)")
      return nil
    }
  }
#endif

  private func projectJointPoint(
    _ worldPoint: SIMD3<Float>,
    arView: ARView,
    frame: ARFrame
  ) -> CGPoint? {
    let viewport = arView.bounds.size
    if viewport.width <= 0 || viewport.height <= 0 {
      return nil
    }
    let orientation = currentInterfaceOrientation(for: arView)
    return frame.camera.projectPoint(worldPoint, orientation: orientation, viewportSize: viewport)
  }

  private func deviceModelIdentifier() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machineMirror = Mirror(reflecting: systemInfo.machine)
    let identifier = machineMirror.children.reduce(into: "") { identifier, element in
      guard let value = element.value as? Int8, value != 0 else { return }
      identifier.append(String(UnicodeScalar(UInt8(value))))
    }
    return identifier
  }

  fileprivate func pickVideoFormat(maxDimension: CGFloat, maxFps: Int) -> ARConfiguration.VideoFormat? {
    let formats = ARBodyTrackingConfiguration.supportedVideoFormats
    guard !formats.isEmpty else {
      return nil
    }

    let fpsFiltered = formats.filter { $0.framesPerSecond <= maxFps }
    let fpsCandidates = fpsFiltered.isEmpty ? formats : fpsFiltered
    let dimFiltered = fpsCandidates.filter {
      max($0.imageResolution.width, $0.imageResolution.height) <= maxDimension
    }
    let candidates = dimFiltered.isEmpty ? fpsCandidates : dimFiltered

    return candidates.max(by: { lhs, rhs in
      let lhsArea = lhs.imageResolution.width * lhs.imageResolution.height
      let rhsArea = rhs.imageResolution.width * rhs.imageResolution.height
      if lhsArea == rhsArea {
        return lhs.framesPerSecond < rhs.framesPerSecond
      }
      return lhsArea < rhsArea
    })
  }

  private func evenDimension(_ value: CGFloat) -> Int {
    let intValue = Int(value.rounded(.down))
    let evenValue = intValue - (intValue % 2)
    return max(2, evenValue)
  }

  private func scaleRecordingResolution(_ resolution: CGSize, maxDimension: CGFloat) -> CGSize {
    let maxSource = max(resolution.width, resolution.height)
    guard maxSource > 0 else {
      return resolution
    }
    if maxSource <= maxDimension {
      return CGSize(width: CGFloat(evenDimension(resolution.width)), height: CGFloat(evenDimension(resolution.height)))
    }

    let scale = maxDimension / maxSource
    let scaledWidth = resolution.width * scale
    let scaledHeight = resolution.height * scale
    return CGSize(width: CGFloat(evenDimension(scaledWidth)), height: CGFloat(evenDimension(scaledHeight)))
  }

  private func computeBodyTrackingSupport(prefix: String, forceDiagnostics: Bool) -> (Bool, [String: Any]) {
    let device = UIDevice.current
    let modelIdentifier = deviceModelIdentifier()
    let systemVersion = device.systemVersion
    let arKitSupported = ARWorldTrackingConfiguration.isSupported
    let bodySupported = ARBodyTrackingConfiguration.isSupported

    print("\(prefix) Device: \(device.model) (\(modelIdentifier))")
    print("\(prefix) System: iOS \(systemVersion)")
    print("\(prefix) ARWorldTrackingConfiguration.isSupported: \(arKitSupported)")
    print("\(prefix) ARBodyTrackingConfiguration.isSupported: \(bodySupported)")

    var diagnostics: [String: Any] = [
      "deviceModel": device.model,
      "modelIdentifier": modelIdentifier,
      "systemVersion": systemVersion,
      "arWorldTrackingSupported": arKitSupported,
      "arBodyTrackingSupported": bodySupported,
      "isMainThread": Thread.isMainThread
    ]

    var finalSupported = bodySupported
    var workaroundApplied = false
    let shouldComputeFormats = forceDiagnostics || !bodySupported

    var formatsCount: Int? = nil
    var bestFormatFps: Int? = nil
    var bestFormatResolution: String? = nil
    var autoImageScale: Bool? = nil
    var autoSkeletonScale: Bool? = nil

    // iOS 26 workaround: isSupported may incorrectly return false on some devices
    // Check if we can actually create a configuration and read video formats
    if shouldComputeFormats {
      if !bodySupported {
        print("\(prefix) isSupported returned false, checking fallback...")
      } else {
        print("\(prefix) Collecting video format diagnostics...")
      }
      // Attempt a fallback instantiation to surface any runtime issues
      print("\(prefix) Attempting to instantiate ARBodyTrackingConfiguration for diagnostics...")
      let configuration = ARBodyTrackingConfiguration()
      let formats = ARBodyTrackingConfiguration.supportedVideoFormats
      formatsCount = formats.count
      print("\(prefix) supportedVideoFormats count: \(formats.count)")
      if let bestFormat = formats.max(by: { $0.framesPerSecond < $1.framesPerSecond }) {
        bestFormatFps = bestFormat.framesPerSecond
        bestFormatResolution = "\(Int(bestFormat.imageResolution.width))x\(Int(bestFormat.imageResolution.height))"
        print("\(prefix) bestFormat fps: \(bestFormat.framesPerSecond) resolution: \(bestFormat.imageResolution)")
      }
      autoImageScale = configuration.automaticImageScaleEstimationEnabled
      print("\(prefix) automaticImageScaleEstimationEnabled: \(configuration.automaticImageScaleEstimationEnabled)")
      if #available(iOS 14.0, *) {
        autoSkeletonScale = configuration.automaticSkeletonScaleEstimationEnabled
        print("\(prefix) automaticSkeletonScaleEstimationEnabled: \(configuration.automaticSkeletonScaleEstimationEnabled)")
      }
    }

    if !bodySupported {
      // WORKAROUND: If we can create a config and get video formats, assume it's supported
      if (formatsCount ?? 0) > 0 && arKitSupported {
        workaroundApplied = true
        finalSupported = true
        print("\(prefix) ⚠️ WORKAROUND: isSupported=false but formats available, assuming supported (iOS 26 workaround)")
      } else {
        finalSupported = false
      }
    }

    diagnostics["formatsCountComputed"] = shouldComputeFormats
    if let formatsCount = formatsCount {
      diagnostics["supportedVideoFormatsCount"] = formatsCount
    }
    if let bestFormatFps = bestFormatFps {
      diagnostics["bestFormatFps"] = bestFormatFps
    }
    if let bestFormatResolution = bestFormatResolution {
      diagnostics["bestFormatResolution"] = bestFormatResolution
    }
    if let autoImageScale = autoImageScale {
      diagnostics["automaticImageScaleEstimationEnabled"] = autoImageScale
    }
    if let autoSkeletonScale = autoSkeletonScale {
      diagnostics["automaticSkeletonScaleEstimationEnabled"] = autoSkeletonScale
    }
    diagnostics["workaroundApplied"] = workaroundApplied
    diagnostics["finalSupported"] = finalSupported

    return (finalSupported, diagnostics)
  }
  
  public func definition() -> ModuleDefinition {
    Name("ARKitBodyTracker")
    
    // Check if ARBodyTrackingConfiguration is supported on this device
    Function("isSupported") { () -> Bool in
      let prefix = "[ARKit][isSupported]"

      if Thread.isMainThread {
        let (supported, _) = self.computeBodyTrackingSupport(prefix: prefix, forceDiagnostics: false)
        return supported
      }

      var result = false
      let semaphore = DispatchSemaphore(value: 0)
      DispatchQueue.main.async {
        let (supported, _) = self.computeBodyTrackingSupport(prefix: prefix, forceDiagnostics: false)
        result = supported
        semaphore.signal()
      }
      semaphore.wait()
      return result
    }

    Function("supportDiagnostics") { () -> [String: Any] in
      let prefix = "[ARKit][supportDiagnostics]"

      if Thread.isMainThread {
        let (_, diagnostics) = self.computeBodyTrackingSupport(prefix: prefix, forceDiagnostics: true)
        return diagnostics
      }

      var diagnostics: [String: Any] = [:]
      let semaphore = DispatchSemaphore(value: 0)
      DispatchQueue.main.async {
        let (_, collected) = self.computeBodyTrackingSupport(prefix: prefix, forceDiagnostics: true)
        diagnostics = collected
        semaphore.signal()
      }
      semaphore.wait()
      return diagnostics
    }

    AsyncFunction("configureMediaPipeShadow") { (options: [String: Any]?, promise: Promise) in
      let configureBlock = {
#if canImport(MediaPipeTasksVision)
        let configured = self.configureMediaPipePoseLandmarker(options: options)
        promise.resolve(configured)
#else
        print("[ARKit][MediaPipe] MediaPipeTasksVision is unavailable in this build")
        promise.resolve(false)
#endif
      }

      if Thread.isMainThread {
        configureBlock()
      } else {
        DispatchQueue.main.async {
          configureBlock()
        }
      }
    }

    AsyncFunction("getCurrentMediaPipePose2D") { (promise: Promise) in
      let detectionBlock = {
#if canImport(MediaPipeTasksVision)
        let payload = self.currentMediaPipePose2DPayload()
        promise.resolve(payload)
#else
        promise.resolve(nil)
#endif
      }

      if Thread.isMainThread {
        detectionBlock()
      } else {
        DispatchQueue.main.async {
          detectionBlock()
        }
      }
    }
    
    Function("setSubjectLockEnabled") { (enabled: Bool) in
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.subjectLockEnabled = enabled
        if !enabled {
          self.lockedBodyAnchorId = nil
          self.lockedMissingCount = 0
          self.lockedBodyAnchorLastSeenTs = 0
        }
        print("[ARKit] Subject lock \(enabled ? "enabled" : "disabled")")
      }
    }

    Function("resetSubjectLock") { () in
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.lockedBodyAnchorId = nil
        self.lockedMissingCount = 0
        self.lockedBodyAnchorLastSeenTs = 0
        print("[ARKit] Subject lock reset")
      }
    }
    
    // Start ARKit body tracking session
    AsyncFunction("startTracking") { (promise: Promise) in
      print("[ARKit] startTracking called")
      
      guard ARBodyTrackingConfiguration.isSupported else {
        print("[ARKit] Body tracking not supported on this device")
        promise.reject("UNSUPPORTED", "ARKit body tracking requires iPhone XS or newer with A12 Bionic chip or later")
        return
      }
      
      print("[ARKit] Body tracking is supported, starting session...")
      
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        
        // Prefer ARSession from mounted ARKitBodyView if available
        if let view = ARKitBodyTrackerModule.sharedARView {
          print("[ARKit] Using ARView.session from ARKitBodyView")
          print("[ARKit] ARView bounds: \(view.bounds)")
          print("[ARKit] ARView isHidden: \(view.isHidden)")
          print("[ARKit] ARView alpha: \(view.alpha)")
          print("[ARKit] ARView superview: \(view.superview != nil ? "exists" : "nil")")
          
          // Ensure view is visible and in view hierarchy
          view.isHidden = false
          view.alpha = 1.0
          
          // Wait a frame to ensure view is laid out
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self = self else {
              promise.reject("ERROR", "Module deallocated before session could start")
              return
            }
            // Use the view's session directly
            self.arSession = view.session
            self.arSession?.delegate = self.sessionDelegate
            
            // Configure body tracking
            let configuration = ARBodyTrackingConfiguration()
            configuration.automaticImageScaleEstimationEnabled = true
            if #available(iOS 14.0, *) {
              configuration.automaticSkeletonScaleEstimationEnabled = true
            }
            if #available(iOS 11.3, *) {
              configuration.isAutoFocusEnabled = true
            }
            if let bestFormat = self.pickVideoFormat(maxDimension: self.sessionMaxDimension, maxFps: self.sessionMaxFps) {
              configuration.videoFormat = bestFormat
            }
            
            // Run the session on the view's session - this will display the camera feed
            print("[ARKit] Running AR session with body tracking configuration on ARView.session")
            print("[ARKit] ARView bounds after delay: \(view.bounds)")
            self.sessionDelegate.owner = self
            view.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
            self.isRunning = true
            
            print("[ARKit] AR session started successfully on ARView")
            promise.resolve(true)
          }
        } else if self.arSession == nil {
          print("[ARKit] Creating new standalone ARSession (no ARView available)")
          self.arSession = ARSession()
          self.arSession?.delegate = self.sessionDelegate
          
          // Configure body tracking
          let configuration = ARBodyTrackingConfiguration()
          configuration.automaticImageScaleEstimationEnabled = true
          if #available(iOS 14.0, *) {
            configuration.automaticSkeletonScaleEstimationEnabled = true
          }
          if #available(iOS 11.3, *) {
            configuration.isAutoFocusEnabled = true
          }
          if let bestFormat = self.pickVideoFormat(maxDimension: self.sessionMaxDimension, maxFps: self.sessionMaxFps) {
            configuration.videoFormat = bestFormat
          }
          
          // Run the session
          print("[ARKit] Running AR session with body tracking configuration")
          self.sessionDelegate.owner = self
          self.arSession?.run(configuration, options: [.resetTracking, .removeExistingAnchors])
          self.isRunning = true
          
          print("[ARKit] AR session started successfully (standalone)")
          promise.resolve(true)
        } else {
          print("[ARKit] Session already exists, reusing")
          promise.resolve(true)
        }
      }
    }
    
    // Get current body pose with all joint positions
    Function("getCurrentPose") { () -> BodyPose? in
      guard let bodyAnchor = self.currentBodyAnchor else {
        return nil
      }
      
      guard bodyAnchor.isTracked else {
        return nil
      }
      let skeleton = bodyAnchor.skeleton
      var joints: [Joint3D] = []
      
      // Map major joints from ARSkeleton using runtime-available names to ensure SDK compatibility
      // Prefer the standard ARKit 3D body names; filter to only those present on this device/SDK
      let preferredJointNamesRaw: [String] = [
        // Root and spine
        "root",
        "hips_joint",
        "spine_1_joint",
        "spine_2_joint",
        "spine_3_joint",
        "spine_4_joint",
        "spine_5_joint",
        "spine_6_joint",
        "spine_7_joint",
        
        // Neck and head
        "neck_1_joint",
        "neck_2_joint",
        "neck_3_joint",
        "neck_4_joint",
        "head_joint",
        
        // Left arm
        "left_shoulder_1_joint",
        "left_arm_joint",
        "left_forearm_joint",
        "left_hand_joint",
        
        // Right arm
        "right_shoulder_1_joint",
        "right_arm_joint",
        "right_forearm_joint",
        "right_hand_joint",
        
        // Left leg
        "left_upLeg_joint",
        "left_leg_joint",
        "left_foot_joint",
        
        // Right leg
        "right_upLeg_joint",
        "right_leg_joint",
        "right_foot_joint"
      ]

      let availableRaw = Set(skeleton.definition.jointNames)
      let jointNames: [ARSkeleton.JointName] = preferredJointNamesRaw
        .filter { availableRaw.contains($0) }
        .map { ARSkeleton.JointName(rawValue: $0) }
      
      for jointName in jointNames {
        // Get the model transform for this joint
        // Combine with body anchor to get world transform
        guard let jointModel = skeleton.modelTransform(for: jointName) else {
          continue
        }
        let worldTransform = simd_mul(bodyAnchor.transform, jointModel)
        let position = worldTransform.columns.3
        
        // Check if this joint is currently tracked
        let isTracked: Bool = {
          let idx = skeleton.definition.index(for: jointName)
          return skeleton.isJointTracked(idx)
        }()
        
        joints.append(Joint3D(
          name: jointName.rawValue,
          x: Double(position.x),
          y: Double(position.y),
          z: Double(position.z),
          isTracked: isTracked
        ))
      }
      
      let frameTs: Double
      let activeSession = self.arSession ?? ARKitBodyTrackerModule.sharedARView?.session
      if let ts = activeSession?.currentFrame?.timestamp {
        frameTs = ts
      } else {
        frameTs = Date().timeIntervalSince1970
      }

      return BodyPose(
        joints: joints,
        timestamp: frameTs,
        isTracking: bodyAnchor.isTracked,
        estimatedHeight: Double(bodyAnchor.estimatedScaleFactor)
      )
    }

    // 2D projection of current body pose into ARKit view space (normalized 0..1)
    let computePose2D: () -> BodyPose2D? = {
      guard let bodyAnchor = self.currentBodyAnchor else {
        print("[ARKit] getCurrentPose2D: No body anchor")
        return nil
      }

      guard bodyAnchor.isTracked else {
        print("[ARKit] getCurrentPose2D: Body anchor not tracked")
        return nil
      }

      guard let arView = ARKitBodyTrackerModule.sharedARView else {
        print("[ARKit] getCurrentPose2D: No shared ARView")
        return nil
      }

      // Ensure view has valid bounds
      let viewW = Double(arView.bounds.width)
      let viewH = Double(arView.bounds.height)
      
      if viewW <= 0 || viewH <= 0 {
        print("[ARKit] getCurrentPose2D: ARView has invalid bounds: \(viewW)x\(viewH)")
        return nil
      }

      guard let frame = (self.arSession ?? ARKitBodyTrackerModule.sharedARView?.session)?.currentFrame else {
        print("[ARKit] getCurrentPose2D: No current ARFrame")
        return nil
      }

      let skeleton = bodyAnchor.skeleton
      var joints2D: [Joint2D] = []

      let preferredJointNamesRaw: [String] = [
        "root",
        "hips_joint",
        "spine_1_joint","spine_2_joint","spine_3_joint","spine_4_joint","spine_5_joint","spine_6_joint","spine_7_joint",
        "neck_1_joint","neck_2_joint","neck_3_joint","neck_4_joint","head_joint",
        "left_shoulder_1_joint","left_arm_joint","left_forearm_joint","left_hand_joint",
        "right_shoulder_1_joint","right_arm_joint","right_forearm_joint","right_hand_joint",
        "left_upLeg_joint","left_leg_joint","left_foot_joint",
        "right_upLeg_joint","right_leg_joint","right_foot_joint"
      ]

      let availableRaw = Set(skeleton.definition.jointNames)
      let jointNames: [ARSkeleton.JointName] = preferredJointNamesRaw
        .filter { availableRaw.contains($0) }
        .map { ARSkeleton.JointName(rawValue: $0) }

      for jointName in jointNames {
        guard let jointModel = skeleton.modelTransform(for: jointName) else { continue }
        let worldTransform = simd_mul(bodyAnchor.transform, jointModel)
        let p = worldTransform.columns.3
        let worldPoint = SIMD3<Float>(p.x, p.y, p.z)
        if let projected = self.projectJointPoint(worldPoint, arView: arView, frame: frame) {
          let nx = max(0.0, min(1.0, Double(projected.x) / viewW))
          let ny = max(0.0, min(1.0, Double(projected.y) / viewH))
          let idx = skeleton.definition.index(for: jointName)
          let tracked = skeleton.isJointTracked(idx)
          joints2D.append(Joint2D(
            name: jointName.rawValue,
            x: nx,
            y: ny,
            isTracked: tracked
          ))
        }
      }

      let frameTs: Double
      let activeSession = self.arSession ?? ARKitBodyTrackerModule.sharedARView?.session
      if let ts = activeSession?.currentFrame?.timestamp {
        frameTs = ts
      } else {
        frameTs = Date().timeIntervalSince1970
      }

      print("[ARKit] getCurrentPose2D: Returning \(joints2D.count) joints")
      return BodyPose2D(joints: joints2D, timestamp: frameTs, isTracking: bodyAnchor.isTracked)
    }

    Function("getCurrentPose2D") { () -> BodyPose2D? in
      if Thread.isMainThread {
        return computePose2D()
      }

      var result: BodyPose2D?
      let semaphore = DispatchSemaphore(value: 0)
      DispatchQueue.main.async {
        result = computePose2D()
        semaphore.signal()
      }
      semaphore.wait()
      return result
    }

    AsyncFunction("getCurrentFrameSnapshot") { (options: [String: Any]?) -> [String: Any]? in
      let maxWidth = (options?["maxWidth"] as? Double) ?? 0
      let quality = (options?["quality"] as? Double) ?? 0.25

      let snapshotBlock = {
        self.makeSnapshotPayload(maxWidth: CGFloat(maxWidth), quality: CGFloat(quality))
      }

      if Thread.isMainThread {
        return snapshotBlock()
      }

      var result: [String: Any]?
      let semaphore = DispatchSemaphore(value: 0)
      DispatchQueue.main.async {
        result = snapshotBlock()
        semaphore.signal()
      }
      semaphore.wait()
      return result
    }
    
    // Stop body tracking session
    Function("stopTracking") { () in
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        if let session = self.arSession {
          session.pause()
        } else if let viewSession = ARKitBodyTrackerModule.sharedARView?.session {
          viewSession.pause()
        }
        self.isRunning = false
        self.currentBodyAnchor = nil
      }
    }

    AsyncFunction("startRecording") { (options: [String: Any]?, promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        guard let self = self else {
          promise.reject("ERROR", "Module deallocated before recording could start")
          return
        }

        guard self.isRunning else {
          promise.reject("NOT_RUNNING", "Body tracking must be running before recording")
          return
        }

        let activeSession = self.arSession ?? ARKitBodyTrackerModule.sharedARView?.session
        guard let session = activeSession,
              let configuration = session.configuration as? ARBodyTrackingConfiguration else {
          promise.reject("NO_SESSION", "No active ARKit body tracking session")
          return
        }

        let quality = (options?["quality"] as? String)?.lowercased()
        let preset = recordingPreset(for: quality)
        self.videoRecorder.recordingQualityLabel = quality ?? "medium"
        let resolution = configuration.videoFormat.imageResolution
        let scaledResolution = self.scaleRecordingResolution(resolution, maxDimension: preset.maxDimension)
        let width = Int(scaledResolution.width)
        let height = Int(scaledResolution.height)
        let fps = min(configuration.videoFormat.framesPerSecond, preset.maxFps)

        if width <= 0 || height <= 0 {
          promise.reject("INVALID_RESOLUTION", "Invalid video resolution for recording")
          return
        }

        if self.videoRecorder.isRecording {
          promise.resolve(true)
          return
        }

        do {
          let orientation = ARKitBodyTrackerModule.sharedARView.map { self.currentInterfaceOrientation(for: $0) } ?? .portrait
          try self.videoRecorder.startRecording(width: width, height: height, fps: fps, preset: preset, orientation: orientation)
          promise.resolve(true)
        } catch {
          promise.reject("REC_START_FAILED", "Failed to start recording: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      if !self.videoRecorder.isRecording {
        promise.resolve(nil)
        return
      }

      self.videoRecorder.stopRecording { result in
        switch result {
        case .success(let url):
          promise.resolve(url.path)
        case .failure(let error):
          promise.reject("REC_STOP_FAILED", error.localizedDescription)
        }
      }
    }

    // Expose the native AR view so JS can render it
    View(ARKitBodyView.self) {}

    // Calculate angle between three 3D points (in degrees)
    Function("calculateAngle") { (joint1: Joint3D, joint2: Joint3D, joint3: Joint3D) -> Double in
      let p1 = simd_float3(Float(joint1.x), Float(joint1.y), Float(joint1.z))
      let p2 = simd_float3(Float(joint2.x), Float(joint2.y), Float(joint2.z))
      let p3 = simd_float3(Float(joint3.x), Float(joint3.y), Float(joint3.z))

      // Create vectors from middle joint to other joints
      let v1 = p1 - p2
      let v2 = p3 - p2

      // Calculate angle using dot product
      let dot = simd_dot(simd_normalize(v1), simd_normalize(v2))
      let angleRadians = acos(max(-1.0, min(1.0, dot)))
      let angleDegrees = angleRadians * 180.0 / .pi

      return Double(angleDegrees)
    }
    
    // Get distance between two joints in meters
    Function("getJointDistance") { (joint1: Joint3D, joint2: Joint3D) -> Double in
      let p1 = simd_float3(Float(joint1.x), Float(joint1.y), Float(joint1.z))
      let p2 = simd_float3(Float(joint2.x), Float(joint2.y), Float(joint2.z))
      let distance = simd_distance(p1, p2)
      return Double(distance)
    }
  }
}
fileprivate final class ARVideoRecorder {
  private var assetWriter: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var outputURL: URL?
  private let queue = DispatchQueue(label: "com.formfactor.arkit.videorecorder")
  private let ciContext = CIContext(options: nil)
  private(set) var isRecording = false
  private var lastPresentationTime = CMTime.zero
  private let timeScale: CMTimeScale = 600
  private var hasWrittenFrame = false
  fileprivate var recordingQualityLabel: String = "unknown"
  private var hasLoggedFrameMetrics = false
  private var hasLoggedOverlayTransform = false

  func startRecording(
    width: Int,
    height: Int,
    fps: Int,
    preset: RecordingPreset,
    orientation: UIInterfaceOrientation
  ) throws {
    if isRecording {
      return
    }

    let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    let baseDir = cachesDir ?? FileManager.default.temporaryDirectory
    let url = baseDir.appendingPathComponent("arkit-set-\(UUID().uuidString).mov")

    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)

    let targetFps = max(24, min(60, fps))
    let pixelCount = max(1, width * height)
    let averageBitRate = Int(CGFloat(pixelCount) * CGFloat(targetFps) * preset.bitsPerPixel)
    let clampedBitRate = max(preset.minBitrate, min(averageBitRate, preset.maxBitrate))
    let compressionProperties: [String: Any] = [
      AVVideoAverageBitRateKey: clampedBitRate,
      AVVideoMaxKeyFrameIntervalKey: targetFps,
      AVVideoExpectedSourceFrameRateKey: targetFps,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel,
      AVVideoAllowFrameReorderingKey: false
    ]

    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: NSNumber(value: width),
      AVVideoHeightKey: NSNumber(value: height),
      AVVideoCompressionPropertiesKey: compressionProperties
    ]

    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    input.expectsMediaDataInRealTime = true
    input.transform = videoTransform(for: orientation, width: width, height: height)

    let attrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: NSNumber(value: kCVPixelFormatType_32BGRA),
      kCVPixelBufferWidthKey as String: NSNumber(value: width),
      kCVPixelBufferHeightKey as String: NSNumber(value: height)
    ]

    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: attrs
    )

    if writer.canAdd(input) {
      writer.add(input)
    } else {
      throw NSError(domain: "ARVideoRecorder", code: -1, userInfo: [NSLocalizedDescriptionKey: "Cannot add video input"])
    }

    assetWriter = writer
    videoInput = input
    pixelBufferAdaptor = adaptor
    outputURL = url
    isRecording = true
    lastPresentationTime = .zero
    hasWrittenFrame = false
    hasLoggedFrameMetrics = false
    hasLoggedOverlayTransform = false

    print(
      "[ARVideoRecorder] Recording started – quality=\(recordingQualityLabel) width=\(width) height=\(height) fps=\(fps) presetMaxDim=\(preset.maxDimension)"
    )
  }

  private func videoTransform(for orientation: UIInterfaceOrientation, width: Int, height: Int) -> CGAffineTransform {
    let w = CGFloat(width)
    let h = CGFloat(height)

    switch orientation {
    case .portrait:
      return CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)
    case .portraitUpsideDown:
      return CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: w)
    case .landscapeLeft:
      return CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: w, ty: h)
    case .landscapeRight:
      return .identity
    default:
      return CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)
    }
  }

  func appendFrame(
    _ frame: ARFrame,
    pose2D: [Joint2D]?,
    orientation: UIInterfaceOrientation,
    viewportSize: CGSize?
  ) {
    guard isRecording,
          let writer = assetWriter,
          let input = videoInput,
          let adaptor = pixelBufferAdaptor else {
      return
    }

    var timestamp = CMTime(seconds: frame.timestamp, preferredTimescale: timeScale)
    if timestamp <= lastPresentationTime {
      let increment = CMTime(value: 1, timescale: timeScale)
      timestamp = lastPresentationTime + increment
    }
    lastPresentationTime = timestamp
    queue.async {
      if writer.status == .unknown {
        writer.startWriting()
        writer.startSession(atSourceTime: timestamp)
      }

      guard writer.status == .writing, input.isReadyForMoreMediaData else {
        return
      }

      var pixelBufferToAppend: CVPixelBuffer = frame.capturedImage

      if let pool = adaptor.pixelBufferPool {
        var outputBuffer: CVPixelBuffer?
        let result = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outputBuffer)
        if result == kCVReturnSuccess, let outputBuffer {
          if !self.hasLoggedFrameMetrics {
            let capturedWidth = CVPixelBufferGetWidth(frame.capturedImage)
            let capturedHeight = CVPixelBufferGetHeight(frame.capturedImage)
            let bufferWidth = CVPixelBufferGetWidth(outputBuffer)
            let bufferHeight = CVPixelBufferGetHeight(outputBuffer)
            print(
              "[ARVideoRecorder] Frame sizes -> captured: \(capturedWidth)x\(capturedHeight), buffer: \(bufferWidth)x\(bufferHeight), quality: \(self.recordingQualityLabel)"
            )
            self.hasLoggedFrameMetrics = true
          }

          let baseImage = CIImage(cvPixelBuffer: frame.capturedImage)
          let targetWidth = CGFloat(CVPixelBufferGetWidth(outputBuffer))
          let targetHeight = CGFloat(CVPixelBufferGetHeight(outputBuffer))
          let sourceExtent = baseImage.extent
          let scaledImage: CIImage
          if sourceExtent.width > 0 && sourceExtent.height > 0 {
            let scaleX = targetWidth / sourceExtent.width
            let scaleY = targetHeight / sourceExtent.height
            let transform = CGAffineTransform(scaleX: scaleX, y: scaleY)
            scaledImage = baseImage.transformed(by: transform)
          } else {
            scaledImage = baseImage
          }

          self.ciContext.render(scaledImage, to: outputBuffer)

          if let pose2D, !pose2D.isEmpty {
            let displayTransform: CGAffineTransform? = {
              guard let viewportSize, viewportSize.width > 0, viewportSize.height > 0 else {
                return nil
              }
              return frame.displayTransform(for: orientation, viewportSize: viewportSize)
            }()

            let viewToImageTransform = displayTransform?.inverted()
            let viewTransformIsInPixels: Bool = {
              guard let displayTransform else { return false }
              let maxAbs = max(
                abs(displayTransform.a),
                abs(displayTransform.b),
                abs(displayTransform.c),
                abs(displayTransform.d)
              )
              // Normalized-space transforms are typically within ~[-2, 2].
              // Pixel-space transforms usually include viewport-sized scalars.
              return maxAbs > 2.0
            }()

            if !self.hasLoggedOverlayTransform {
              let viewportLabel = viewportSize.map { "\($0.width)x\($0.height)" } ?? "nil"
              let transformLabel = displayTransform.map {
                "a=\($0.a) b=\($0.b) c=\($0.c) d=\($0.d) tx=\($0.tx) ty=\($0.ty)"
              } ?? "nil"
              print(
                "[ARVideoRecorder] Overlay mapping -> viewport=\(viewportLabel) pixelsTransform=\(viewTransformIsInPixels) displayTransform=\(transformLabel)"
              )
              self.hasLoggedOverlayTransform = true
            }

            self.drawOverlay(
              on: outputBuffer,
              joints: pose2D,
              viewToImageTransform: viewToImageTransform,
              viewportSize: viewportSize,
              viewTransformIsInPixels: viewTransformIsInPixels
            )
          }

          pixelBufferToAppend = outputBuffer
        }
      }

      if adaptor.append(pixelBufferToAppend, withPresentationTime: timestamp) {
        self.hasWrittenFrame = true
      } else if let error = writer.error {
        print("[ARVideoRecorder] Failed to append frame: \(error.localizedDescription)")
      }
    }
  }

  private func drawOverlay(
    on buffer: CVPixelBuffer,
    joints: [Joint2D],
    viewToImageTransform: CGAffineTransform?,
    viewportSize: CGSize?,
    viewTransformIsInPixels: Bool
  ) {
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else {
      return
    }

    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue

    guard let context = CGContext(
      data: baseAddress,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: bitmapInfo
    ) else {
      return
    }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    context.setLineCap(.round)

    let minDim = CGFloat(min(width, height))
    let lineWidth = max(0.5, minDim * 0.004)
    let jointRadius = max(1.0, minDim * 0.006)

    var jointsByName: [String: Joint2D] = [:]
    for joint in joints {
      jointsByName[joint.name.lowercased()] = joint
    }

    func findJoint(_ name: String) -> Joint2D? {
      let lower = name.lowercased()
      if let joint = jointsByName[lower], joint.isTracked {
        return joint
      }
      for joint in joints {
        if !joint.isTracked { continue }
        let key = joint.name.lowercased()
        if key.contains(lower) || lower.contains(key.replacingOccurrences(of: "_joint", with: "")) {
          return joint
        }
      }
      return nil
    }

    func strokeColor(_ hex: UInt32) {
      let r = CGFloat((hex >> 16) & 0xFF) / 255.0
      let g = CGFloat((hex >> 8) & 0xFF) / 255.0
      let b = CGFloat(hex & 0xFF) / 255.0
      context.setStrokeColor(red: r, green: g, blue: b, alpha: 0.9)
    }

    func fillColor(_ hex: UInt32) {
      let r = CGFloat((hex >> 16) & 0xFF) / 255.0
      let g = CGFloat((hex >> 8) & 0xFF) / 255.0
      let b = CGFloat(hex & 0xFF) / 255.0
      context.setFillColor(red: r, green: g, blue: b, alpha: 0.9)
    }

    func mapJoint(_ joint: Joint2D) -> CGPoint? {
      guard joint.isTracked else {
        return nil
      }

      let viewPointNormalized = CGPoint(x: CGFloat(joint.x), y: CGFloat(joint.y))
      let viewPoint: CGPoint = {
        if viewTransformIsInPixels, let viewportSize, viewportSize.width > 0, viewportSize.height > 0 {
          return CGPoint(
            x: viewPointNormalized.x * viewportSize.width,
            y: viewPointNormalized.y * viewportSize.height
          )
        }
        return viewPointNormalized
      }()

      if let viewToImageTransform {
        let imagePoint = viewPoint.applying(viewToImageTransform)
        let clampedX = min(max(imagePoint.x, 0), 1)
        let clampedY = min(max(imagePoint.y, 0), 1)
        return CGPoint(x: clampedX * CGFloat(width), y: clampedY * CGFloat(height))
      }

      // Fallback: if we can't compute ARFrame's display transform for some reason, skip drawing.
      // This avoids drawing with a guessed mapping that can be noticeably mis-scaled.
      return nil
    }

    func drawLine(_ from: String, _ to: String, color: UInt32) {
      guard let j1 = findJoint(from), let j2 = findJoint(to), j1.isTracked, j2.isTracked else {
        return
      }
      guard let p1 = mapJoint(j1), let p2 = mapJoint(j2) else {
        return
      }
      strokeColor(color)
      context.setLineWidth(lineWidth)
      context.move(to: p1)
      context.addLine(to: p2)
      context.strokePath()
    }

    // Spine
    drawLine("hips_joint", "spine_4_joint", color: 0x4C8CFF)
    drawLine("spine_4_joint", "neck_1_joint", color: 0x4C8CFF)
    drawLine("neck_1_joint", "head_joint", color: 0x4C8CFF)

    // Left arm
    drawLine("neck_1_joint", "left_shoulder_1_joint", color: 0x3CC8A9)
    drawLine("left_shoulder_1_joint", "left_arm_joint", color: 0x3CC8A9)
    drawLine("left_arm_joint", "left_forearm_joint", color: 0x3CC8A9)
    drawLine("left_forearm_joint", "left_hand_joint", color: 0x3CC8A9)

    // Right arm
    drawLine("neck_1_joint", "right_shoulder_1_joint", color: 0x3CC8A9)
    drawLine("right_shoulder_1_joint", "right_arm_joint", color: 0x3CC8A9)
    drawLine("right_arm_joint", "right_forearm_joint", color: 0x3CC8A9)
    drawLine("right_forearm_joint", "right_hand_joint", color: 0x3CC8A9)

    // Left leg
    drawLine("hips_joint", "left_upLeg_joint", color: 0x9B7EDE)
    drawLine("left_upLeg_joint", "left_leg_joint", color: 0x9B7EDE)
    drawLine("left_leg_joint", "left_foot_joint", color: 0x9B7EDE)

    // Right leg
    drawLine("hips_joint", "right_upLeg_joint", color: 0x9B7EDE)
    drawLine("right_upLeg_joint", "right_leg_joint", color: 0x9B7EDE)
    drawLine("right_leg_joint", "right_foot_joint", color: 0x9B7EDE)

    // Joints
    fillColor(0xFFFFFF)
    for joint in joints where joint.isTracked {
      guard let point = mapJoint(joint) else {
        continue
      }
      let rect = CGRect(
        x: point.x - jointRadius,
        y: point.y - jointRadius,
        width: jointRadius * 2,
        height: jointRadius * 2
      )
      context.fillEllipse(in: rect)
    }
  }

  func stopRecording(completion: @escaping (Result<URL, Error>) -> Void) {
    guard isRecording, let writer = assetWriter, let input = videoInput else {
      let error = NSError(domain: "ARVideoRecorder", code: -2, userInfo: [NSLocalizedDescriptionKey: "No active recording"])
      completion(.failure(error))
      return
    }

    isRecording = false
    let recordedFrames = hasWrittenFrame
    hasWrittenFrame = false
    hasLoggedFrameMetrics = false
    hasLoggedOverlayTransform = false
    lastPresentationTime = .zero

    queue.async {
      input.markAsFinished()

      writer.finishWriting {
        let status = writer.status
        let writerError = writer.error
        let url = self.outputURL

        self.assetWriter = nil
        self.videoInput = nil
        self.pixelBufferAdaptor = nil
        self.outputURL = nil

        DispatchQueue.main.async {
            if status == .completed, let finalURL = url {
            completion(.success(finalURL))
          } else if !recordedFrames {
            let noFramesError = NSError(
              domain: "ARVideoRecorder",
              code: -4,
              userInfo: [NSLocalizedDescriptionKey: "No frames were captured before stopping the recording."]
            )
            completion(.failure(noFramesError))
          } else if let finalURL = url, FileManager.default.fileExists(atPath: finalURL.path) {
            completion(.success(finalURL))
          } else {
            let errorDescription: String
            if let writerError = writerError as NSError? {
              errorDescription = "Failed to finalize recording (\(writerError.domain) \(writerError.code)): \(writerError.localizedDescription)"
            } else {
              errorDescription = "Failed to finalize recording (status: \(status.rawValue))"
            }
            let error = NSError(
              domain: "ARVideoRecorder",
              code: writerError.map { ($0 as NSError).code } ?? -3,
              userInfo: [NSLocalizedDescriptionKey: errorDescription]
            )
            completion(.failure(error))
          }
        }
      }
    }
  }
}

// MARK: - ARKit Session Delegate Helper

fileprivate final class ARKitSessionDelegate: NSObject, ARSessionDelegate {
  weak var owner: ARKitBodyTrackerModule?

  init(owner: ARKitBodyTrackerModule) {
    self.owner = owner
  }

  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
    guard let owner else { return }

    let bodyAnchors = anchors.compactMap { $0 as? ARBodyAnchor }
    guard !bodyAnchors.isEmpty else {
      return
    }

    print("[ARKit] Did update anchors (count: \(bodyAnchors.count))")
    for anchor in bodyAnchors {
      print(
        "[ARKit] Candidate anchor \(anchor.identifier) scale=\(anchor.estimatedScaleFactor) tracked=\(anchor.isTracked)"
      )
    }

    let now = CACurrentMediaTime()
    if owner.subjectLockEnabled, let lockedId = owner.lockedBodyAnchorId {
      if let locked = bodyAnchors.first(where: { $0.identifier == lockedId }) {
        print("[ARKit] Locked anchor still in frame: \(locked.identifier)")
        owner.currentBodyAnchor = locked
        owner.lockedMissingCount = 0
        owner.lockedBodyAnchorLastSeenTs = now
        return
      }

      owner.lockedMissingCount += 1
      if now - owner.lockedBodyAnchorLastSeenTs < owner.subjectLockTimeout {
        print(
          "[ARKit] Locked anchor missing (\(owner.lockedMissingCount)), waiting \(owner.subjectLockTimeout)s before reacquire"
        )
        return
      }

      print("[ARKit] Locked anchor timed out after \(owner.subjectLockTimeout)s, clearing lock")
      owner.lockedBodyAnchorId = nil
      owner.lockedMissingCount = 0
      owner.lockedBodyAnchorLastSeenTs = 0
    }

    guard let best = bodyAnchors.max(by: { $0.estimatedScaleFactor < $1.estimatedScaleFactor }) else {
      return
    }

    owner.currentBodyAnchor = best
    if owner.subjectLockEnabled {
      owner.lockedBodyAnchorId = best.identifier
      owner.lockedMissingCount = 0
      owner.lockedBodyAnchorLastSeenTs = now
    }
    print("[ARKit] Selected anchor \(best.identifier) (scale=\(best.estimatedScaleFactor))")
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard let owner else { return }

    if owner.videoRecorder.isRecording {
      let arView = ARKitBodyTrackerModule.sharedARView
      let orientation = arView.map { owner.currentInterfaceOrientation(for: $0) } ?? .portrait
      let viewportSize = arView?.bounds.size
      let pose2D: [Joint2D] = (owner.currentBodyAnchor.flatMap { anchor in
        if let view = arView {
          return owner.computePose2DJoints(frame: frame, bodyAnchor: anchor, arView: view)
        }
        return nil
      }) ?? []
      owner.videoRecorder.appendFrame(frame, pose2D: pose2D, orientation: orientation, viewportSize: viewportSize)
    }
  }

  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    guard let owner else { return }
    for anchor in anchors {
      if let bodyAnchor = anchor as? ARBodyAnchor {
        if owner.lockedBodyAnchorId == bodyAnchor.identifier {
          owner.lockedBodyAnchorId = nil
          owner.lockedMissingCount = 0
          owner.lockedBodyAnchorLastSeenTs = 0
          print("[ARKit] Locked anchor removed: \(bodyAnchor.identifier)")
        }
        owner.currentBodyAnchor = nil
        break
      }
    }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    print("ARSession failed: \(error.localizedDescription)")
    owner?.isRunning = false
  }

  func sessionWasInterrupted(_ session: ARSession) {
    print("ARSession was interrupted")
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    guard let owner, owner.isRunning else { return }

    print("ARSession interruption ended - restarting session")

    let configuration = ARBodyTrackingConfiguration()
    configuration.automaticImageScaleEstimationEnabled = true

    if #available(iOS 14.0, *) {
      configuration.automaticSkeletonScaleEstimationEnabled = true
    }

    if #available(iOS 11.3, *) {
      configuration.isAutoFocusEnabled = true
    }

    if let bestFormat = owner.pickVideoFormat(maxDimension: owner.sessionMaxDimension, maxFps: owner.sessionMaxFps) {
      configuration.videoFormat = bestFormat
    }

    session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
  }
}

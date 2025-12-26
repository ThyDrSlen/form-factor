import ExpoModulesCore
import ARKit
import RealityKit
import UIKit
import AVFoundation
import CoreImage
import ImageIO

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

public class ARKitBodyTrackerModule: Module {
  private var arSession: ARSession?
  fileprivate(set) var currentBodyAnchor: ARBodyAnchor?
  fileprivate(set) var isRunning = false
  private lazy var sessionDelegate = ARKitSessionDelegate(owner: self)
  // If an ARKitBodyView is mounted, it will set this reference so we can drive its session
  public static var sharedARView: ARView?
  fileprivate let videoRecorder = ARVideoRecorder()
  private let ciContext = CIContext(options: nil)

  private func currentInterfaceOrientation(for view: UIView) -> UIInterfaceOrientation {
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
            if let bestFormat = ARBodyTrackingConfiguration.supportedVideoFormats.max(by: { $0.framesPerSecond < $1.framesPerSecond }) {
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
          if let bestFormat = ARBodyTrackingConfiguration.supportedVideoFormats.max(by: { $0.framesPerSecond < $1.framesPerSecond }) {
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

    AsyncFunction("startRecording") { (promise: Promise) in
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

        let resolution = configuration.videoFormat.imageResolution
        let width = Int(resolution.width)
        let height = Int(resolution.height)

        if width <= 0 || height <= 0 {
          promise.reject("INVALID_RESOLUTION", "Invalid video resolution for recording")
          return
        }

        if self.videoRecorder.isRecording {
          promise.resolve(true)
          return
        }

        do {
          try self.videoRecorder.startRecording(width: width, height: height)
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
  private(set) var isRecording = false
  private var lastPresentationTime = CMTime.zero
  private let timeScale: CMTimeScale = 600
  private var hasWrittenFrame = false

  func startRecording(width: Int, height: Int) throws {
    if isRecording {
      return
    }

    let tempDir = FileManager.default.temporaryDirectory
    let url = tempDir.appendingPathComponent("arkit-set-\(UUID().uuidString).mov")

    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)

    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: NSNumber(value: width),
      AVVideoHeightKey: NSNumber(value: height)
    ]

    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    input.expectsMediaDataInRealTime = true

    let attrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: NSNumber(value: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange),
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
  }

  func appendFrame(_ frame: ARFrame) {
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
    let pixelBuffer = frame.capturedImage

    queue.async {
      if writer.status == .unknown {
        writer.startWriting()
        writer.startSession(atSourceTime: timestamp)
      }

      if writer.status == .writing && input.isReadyForMoreMediaData {
        if adaptor.append(pixelBuffer, withPresentationTime: timestamp) {
          self.hasWrittenFrame = true
        } else if let error = writer.error {
          print("[ARVideoRecorder] Failed to append frame: \(error.localizedDescription)")
        }
      }
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

    for anchor in anchors {
      if let bodyAnchor = anchor as? ARBodyAnchor {
        print("[ARKit] Body detected! Updating body anchor. Tracked: \(bodyAnchor.isTracked)")
        owner.currentBodyAnchor = bodyAnchor
        break
      }
    }
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard let owner else { return }

    if owner.videoRecorder.isRecording {
      owner.videoRecorder.appendFrame(frame)
    }
  }

  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    guard let owner else { return }
    for anchor in anchors {
      if anchor is ARBodyAnchor {
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

    if let bestFormat = ARBodyTrackingConfiguration.supportedVideoFormats.max(by: { $0.framesPerSecond < $1.framesPerSecond }) {
      configuration.videoFormat = bestFormat
    }

    session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
  }
}

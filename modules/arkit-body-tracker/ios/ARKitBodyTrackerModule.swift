import ExpoModulesCore
import ARKit
import RealityKit

// Represents a 3D joint with position and tracking state
public struct Joint3D: Record {
  @Field var name: String
  @Field var x: Float // Meters in world space
  @Field var y: Float // Meters in world space  
  @Field var z: Float // Meters in world space
  @Field var isTracked: Bool
}

// Body pose data with joints and metadata
public struct BodyPose: Record {
  @Field var joints: [Joint3D]
  @Field var timestamp: Double
  @Field var isTracking: Bool
  @Field var estimatedHeight: Float?
}

public class ARKitBodyTrackerModule: Module {
  private var arSession: ARSession?
  private var currentBodyAnchor: ARBodyAnchor?
  private var isRunning = false
  
  public func definition() -> ModuleDefinition {
    Name("ARKitBodyTracker")
    
    // Check if ARBodyTrackingConfiguration is supported on this device
    Function("isSupported") { () -> Bool in
      return ARBodyTrackingConfiguration.isSupported
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
        
        // Create AR session if not exists
        if self.arSession == nil {
          print("[ARKit] Creating new AR session")
          self.arSession = ARSession()
          self.arSession?.delegate = self
        }
        
        // Configure body tracking
        let configuration = ARBodyTrackingConfiguration()
        
        // Enable automatic image scale estimation for better accuracy
        configuration.automaticImageScaleEstimationEnabled = true
        
        // Optional: Enable automatic skeleton scale estimation
        if #available(iOS 14.0, *) {
          configuration.automaticSkeletonScaleEstimationEnabled = true
        }
        
        // Run the session
        print("[ARKit] Running AR session with body tracking configuration")
        self.arSession?.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        self.isRunning = true
        
        print("[ARKit] AR session started successfully")
        promise.resolve(true)
      }
    }
    
    // Get current body pose with all joint positions
    Function("getCurrentPose") { () -> BodyPose? in
      guard let bodyAnchor = self.currentBodyAnchor else {
        print("[ARKit] getCurrentPose: No body anchor available")
        return nil
      }
      
      print("[ARKit] getCurrentPose: Body anchor found, extracting joints...")
      let skeleton = bodyAnchor.skeleton
      var joints: [Joint3D] = []
      
      // Map all major joints from ARSkeleton
      // ARSkeleton has 91 joints total, we're extracting the most important ones
      let jointNames: [ARSkeleton.JointName] = [
        // Root and spine
        .root,
        .hips_joint,
        .spine_1_joint,
        .spine_2_joint,
        .spine_3_joint,
        .spine_4_joint,
        .spine_5_joint,
        .spine_6_joint,
        .spine_7_joint,
        
        // Neck and head
        .neck_1_joint,
        .neck_2_joint,
        .neck_3_joint,
        .neck_4_joint,
        .head_joint,
        
        // Left arm
        .left_shoulder_1_joint,
        .left_arm_joint,
        .left_forearm_joint,
        .left_hand_joint,
        
        // Right arm
        .right_shoulder_1_joint,
        .right_arm_joint,
        .right_forearm_joint,
        .right_hand_joint,
        
        // Left leg
        .left_upLeg_joint,
        .left_leg_joint,
        .left_foot_joint,
        
        // Right leg
        .right_upLeg_joint,
        .right_leg_joint,
        .right_foot_joint
      ]
      
      for jointName in jointNames {
        // Get the model transform for this joint
        // This gives us a 4x4 matrix representing position and orientation
        guard let jointTransform = skeleton.modelTransform(for: jointName) else {
          continue
        }
        
        // Extract position from the transform matrix (4th column)
        let position = jointTransform.columns.3
        
        // Check if this joint is currently tracked
        let isTracked = skeleton.isJointTracked(jointName)
        
        joints.append(Joint3D(
          name: "\(jointName)",
          x: position.x,
          y: position.y,
          z: position.z,
          isTracked: isTracked
        ))
      }
      
      return BodyPose(
        joints: joints,
        timestamp: Date().timeIntervalSince1970,
        isTracking: true,
        estimatedHeight: bodyAnchor.estimatedScaleFactor
      )
    }
    
    // Stop body tracking session
    Function("stopTracking") { () in
      DispatchQueue.main.async { [weak self] in
        self?.arSession?.pause()
        self?.isRunning = false
        self?.currentBodyAnchor = nil
      }
    }
    
    // Calculate angle between three 3D points (in degrees)
    Function("calculateAngle") { (joint1: Joint3D, joint2: Joint3D, joint3: Joint3D) -> Double in
      let p1 = simd_float3(joint1.x, joint1.y, joint1.z)
      let p2 = simd_float3(joint2.x, joint2.y, joint2.z)
      let p3 = simd_float3(joint3.x, joint3.y, joint3.z)
      
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
      let p1 = simd_float3(joint1.x, joint1.y, joint1.z)
      let p2 = simd_float3(joint2.x, joint2.y, joint2.z)
      let distance = simd_distance(p1, p2)
      return Double(distance)
    }
  }
}

// MARK: - ARSessionDelegate
extension ARKitBodyTrackerModule: ARSessionDelegate {
  public func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
    // Update current body anchor when ARKit detects or updates body tracking
    for anchor in anchors {
      if let bodyAnchor = anchor as? ARBodyAnchor {
        print("[ARKit] Body detected! Updating body anchor. Tracked: \(bodyAnchor.isTracked)")
        self.currentBodyAnchor = bodyAnchor
        break
      }
    }
  }
  
  public func session(_ session: ARSession, didFailWithError error: Error) {
    print("ARSession failed: \(error.localizedDescription)")
    self.isRunning = false
  }
  
  public func sessionWasInterrupted(_ session: ARSession) {
    print("ARSession was interrupted")
  }
  
  public func sessionInterruptionEnded(_ session: ARSession) {
    print("ARSession interruption ended")
    
    // Restart tracking if it was running before interruption
    if self.isRunning {
      let configuration = ARBodyTrackingConfiguration()
      configuration.automaticImageScaleEstimationEnabled = true
      
      if #available(iOS 14.0, *) {
        configuration.automaticSkeletonScaleEstimationEnabled = true
      }
      
      session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }
  }
}

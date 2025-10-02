import Foundation
import Vision
import CoreImage
import AVFoundation

// Note: VisionCamera types are imported via bridging header

@objc(VisionPoseDetector)
public class VisionPoseDetector: NSObject {
  
  private static var frameCount = 0
  private static let frameSkip = 2 // Process every 3rd frame for 20fps (60fps / 3)
  
  @objc
  public static func callback(frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    // Frame throttling for performance
    frameCount += 1
    if frameCount % frameSkip != 0 {
      return nil
    }
    
    guard let buffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return nil
    }
    
    let imageBuffer = buffer
    
    // Detect camera orientation from frame
    let uiOrientation = frame.orientation
    // Convert UIImage.Orientation to CGImagePropertyOrientation
    let orientation = CGImagePropertyOrientation(rawValue: UInt32(uiOrientation.rawValue)) ?? .up
    let isFrontCamera = arguments?["isFrontCamera"] as? Bool ?? false
    
    // Use 3D body pose detection on iOS 17+
    if #available(iOS 17.0, *) {
      return detect3DPose(imageBuffer: imageBuffer, orientation: orientation, isFrontCamera: isFrontCamera)
    } else {
      return detect2DPose(imageBuffer: imageBuffer, orientation: orientation, isFrontCamera: isFrontCamera)
    }
  }
  
  // 3D pose detection for iOS 17+
  @available(iOS 17.0, *)
  private static func detect3DPose(imageBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation, isFrontCamera: Bool) -> [String: Any]? {
    let request = VNDetectHumanBodyPose3DRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: imageBuffer, orientation: orientation, options: [:])
    
    do {
      try handler.perform([request])
      
      guard let observations = request.results,
            let observation = observations.first else {
        return nil
      }
      
      var joints: [[String: Any]] = []
      
      // 3D joint mapping
      let jointMapping: [VNHumanBodyPose3DObservation.JointName: String] = [
        .centerHead: "head",
        .centerShoulder: "neck",
        .leftShoulder: "leftShoulder",
        .rightShoulder: "rightShoulder",
        .leftElbow: "leftElbow",
        .rightElbow: "rightElbow",
        .leftWrist: "leftWrist",
        .rightWrist: "rightWrist",
        .root: "hips",
        .leftHip: "leftHip",
        .rightHip: "rightHip",
        .leftKnee: "leftKnee",
        .rightKnee: "rightKnee",
        .leftAnkle: "leftAnkle",
        .rightAnkle: "rightAnkle"
      ]
      
      for (visionJoint, ourJointName) in jointMapping {
        if let point = try? observation.recognizedPoint(visionJoint) {
          // Get 3D position - localPosition is a 4x4 transform matrix
          // Extract translation from the matrix (4th column)
          let transform = point.localPosition
          let positionX = transform.columns.3.x
          let positionY = transform.columns.3.y
          let positionZ = transform.columns.3.z
          
          // Convert to 2D screen space (using camera matrix)
          // For simplicity, project to XY plane
          var x = Double(positionX) + 0.5 // Center around 0.5
          var y = 0.5 - Double(positionY) // Flip Y and center
          let z = Double(positionZ)
          
          // Flip X for front camera
          if isFrontCamera {
            x = 1.0 - x
          }
          
          // Clamp to screen bounds
          x = max(0.0, min(1.0, x))
          y = max(0.0, min(1.0, y))
          
          let jointData: [String: Any] = [
            "name": ourJointName,
            "x": x,
            "y": y,
            "z": z,
            "confidence": 0.9 // 3D detection doesn't provide per-joint confidence
          ]
          
          joints.append(jointData)
        }
      }
      
      return [
        "joints": joints,
        "timestamp": Date().timeIntervalSince1970,
        "is3D": true,
        "detectionQuality": 0.9
      ]
      
    } catch {
      print("3D pose detection failed: \(error)")
      return nil
    }
  }
  
  // 2D pose detection fallback for iOS < 17
  private static func detect2DPose(imageBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation, isFrontCamera: Bool) -> [String: Any]? {
    let request = VNDetectHumanBodyPoseRequest()
    request.revision = VNDetectHumanBodyPoseRequestRevision1
    
    let handler = VNImageRequestHandler(cvPixelBuffer: imageBuffer, orientation: orientation, options: [:])
    
    do {
      try handler.perform([request])
      
      guard let observations = request.results,
            let observation = observations.first else {
        return nil
      }
      
      // Get all recognized points
      guard let recognizedPoints = try? observation.recognizedPoints(.all) else {
        return nil
      }
      
      var joints: [[String: Any]] = []
      
      // 2D joint mapping
      let jointMapping: [VNHumanBodyPoseObservation.JointName: String] = [
        .nose: "head",
        .neck: "neck",
        .leftShoulder: "leftShoulder",
        .rightShoulder: "rightShoulder",
        .leftElbow: "leftElbow",
        .rightElbow: "rightElbow",
        .leftWrist: "leftWrist",
        .rightWrist: "rightWrist",
        .root: "hips",
        .leftHip: "leftHip",
        .rightHip: "rightHip",
        .leftKnee: "leftKnee",
        .rightKnee: "rightKnee",
        .leftAnkle: "leftAnkle",
        .rightAnkle: "rightAnkle"
      ]
      
      for (visionJoint, ourJointName) in jointMapping {
        if let point = recognizedPoints[visionJoint] {
          // Only include points with sufficient confidence
          if point.confidence > 0.3 {
            var x = Double(point.location.x)
            let y = Double(1.0 - point.location.y) // Flip Y coordinate
            
            // Flip X for front camera
            if isFrontCamera {
              x = 1.0 - x
            }
            
            let jointData: [String: Any] = [
              "name": ourJointName,
              "x": x,
              "y": y,
              "z": 0.0,
              "confidence": Double(point.confidence)
            ]
            
            joints.append(jointData)
          }
        }
      }
      
      return [
        "joints": joints,
        "timestamp": Date().timeIntervalSince1970,
        "is3D": false,
        "detectionQuality": observation.confidence
      ]
      
    } catch {
      print("2D pose detection failed: \(error)")
      return nil
    }
  }
}

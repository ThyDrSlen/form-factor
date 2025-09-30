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
    let orientation = frame.orientation
    let isFrontCamera = arguments?["isFrontCamera"] as? Bool ?? false
    
    // Use 3D body pose detection for better tracking (iOS 17+)
    let request: VNRequest
    var is3DRequest = false
    
    if #available(iOS 17.0, *) {
      request = VNDetectHumanBodyPose3DRequest()
      is3DRequest = true
    } else {
      // Fallback to 2D for older iOS
      let pose2D = VNDetectHumanBodyPoseRequest()
      pose2D.revision = VNDetectHumanBodyPoseRequestRevision1
      request = pose2D
    }
    
    let handler = VNImageRequestHandler(cvPixelBuffer: imageBuffer, orientation: orientation, options: [:])
    
    do {
      try handler.perform([request])
      
      guard let observations = request.results as? [VNHumanBodyPoseObservation],
            let observation = observations.first else {
        return nil
      }
      
      // Get all recognized points
      guard let recognizedPoints = try? observation.recognizedPoints(.all) else {
        return nil
      }
      
      var joints: [[String: Any]] = []
      
      // Map Vision framework joints to our format
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
            var y = Double(1.0 - point.location.y) // Flip Y coordinate
            
            // Flip X for front camera
            if isFrontCamera {
              x = 1.0 - x
            }
            
            var jointData: [String: Any] = [
              "name": ourJointName,
              "x": x,
              "y": y,
              "confidence": Double(point.confidence)
            ]
            
            // Add Z coordinate for 3D tracking (iOS 17+)
            if #available(iOS 17.0, *), is3DRequest {
              if let observation3D = observation as? VNHumanBodyPose3DObservation {
                if let recognizedPoint3D = try? observation3D.recognizedPoint(visionJoint) {
                  jointData["z"] = Double(recognizedPoint3D.localPosition.z)
                }
              }
            }
            
            joints.append(jointData)
          }
        }
      }
      
      return [
        "joints": joints,
        "timestamp": Date().timeIntervalSince1970,
        "is3D": is3DRequest,
        "detectionQuality": observation.confidence
      ]
      
    } catch {
      print("Body pose detection failed: \(error)")
      return nil
    }
  }
}

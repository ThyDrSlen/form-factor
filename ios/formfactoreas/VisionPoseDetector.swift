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
    
    // Use 2D body pose detection (works reliably on all iOS versions)
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
            let y = Double(1.0 - point.location.y) // Flip Y coordinate
            
            // Flip X for front camera
            if isFrontCamera {
              x = 1.0 - x
            }
            
            let jointData: [String: Any] = [
              "name": ourJointName,
              "x": x,
              "y": y,
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
      print("Body pose detection failed: \(error)")
      return nil
    }
  }
}
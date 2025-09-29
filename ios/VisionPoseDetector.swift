import Foundation
import Vision
import CoreImage
import AVFoundation

@objc(VisionPoseDetector)
public class VisionPoseDetector: NSObject {
  
  @objc
  public static func callback(frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard let buffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return nil
    }
    
    let imageBuffer = buffer
    
    let request = VNDetectHumanBodyPoseRequest()
    request.revision = VNDetectHumanBodyPoseRequestRevision1
    
    let handler = VNImageRequestHandler(cvPixelBuffer: imageBuffer, orientation: .up, options: [:])
    
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
            joints.append([
              "name": ourJointName,
              "x": Double(point.location.x),
              "y": Double(1.0 - point.location.y), // Flip Y coordinate
              "confidence": Double(point.confidence)
            ])
          }
        }
      }
      
      return [
        "joints": joints,
        "timestamp": Date().timeIntervalSince1970
      ]
      
    } catch {
      print("Body pose detection failed: \(error)")
      return nil
    }
  }
}

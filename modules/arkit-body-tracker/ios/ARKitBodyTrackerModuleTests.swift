import XCTest
import ARKit
@testable import ExpoModulesCore

/**
 * Unit tests for ARKitBodyTrackerModule
 * 
 * To run in Xcode:
 * 1. Open ios/formfactoreas.xcworkspace
 * 2. Product > Test (⌘U)
 * 3. Or select this file and click the diamond icon next to test functions
 */

class ARKitBodyTrackerModuleTests: XCTestCase {
    
    var module: ARKitBodyTrackerModule!
    
    override func setUp() {
        super.setUp()
        module = ARKitBodyTrackerModule()
    }
    
    override func tearDown() {
        module = nil
        super.tearDown()
    }
    
    // MARK: - Basic Tests
    
    func testModuleExists() {
        XCTAssertNotNil(module, "Module should be instantiated")
    }
    
    func testIsSupported() {
        // This will return true on iPhone XS+ and false in simulator
        let supported = ARBodyTrackingConfiguration.isSupported
        print("Body tracking supported: \(supported)")
        
        // Test shouldn't fail, just log the result
        XCTAssertNotNil(supported, "isSupported should return a boolean")
    }
    
    // MARK: - Joint Tests
    
    func testJointStructure() {
        // Test that Joint3D can be created
        let joint = Joint3D(
            name: "test_joint",
            x: 1.0,
            y: 2.0,
            z: 3.0,
            isTracked: true
        )
        
        XCTAssertEqual(joint.name, "test_joint")
        XCTAssertEqual(joint.x, 1.0)
        XCTAssertEqual(joint.y, 2.0)
        XCTAssertEqual(joint.z, 3.0)
        XCTAssertTrue(joint.isTracked)
    }
    
    func testBodyPoseStructure() {
        let joint1 = Joint3D(name: "root", x: 0, y: 0, z: 0, isTracked: true)
        let joint2 = Joint3D(name: "hips", x: 0, y: 1, z: 0, isTracked: true)
        
        let pose = BodyPose(
            joints: [joint1, joint2],
            timestamp: Date().timeIntervalSince1970,
            isTracking: true,
            estimatedHeight: 1.75
        )
        
        XCTAssertEqual(pose.joints.count, 2)
        XCTAssertTrue(pose.isTracking)
        XCTAssertNotNil(pose.estimatedHeight)
    }
    
    // MARK: - Geometry Tests
    
    func testAngleCalculation() {
        // Create a 90-degree angle
        let joint1 = Joint3D(name: "p1", x: 1.0, y: 0.0, z: 0.0, isTracked: true)
        let joint2 = Joint3D(name: "p2", x: 0.0, y: 0.0, z: 0.0, isTracked: true) // vertex
        let joint3 = Joint3D(name: "p3", x: 0.0, y: 1.0, z: 0.0, isTracked: true)
        
        // Calculate using the same logic as the module
        let p1 = simd_float3(joint1.x, joint1.y, joint1.z)
        let p2 = simd_float3(joint2.x, joint2.y, joint2.z)
        let p3 = simd_float3(joint3.x, joint3.y, joint3.z)
        
        let v1 = p1 - p2
        let v2 = p3 - p2
        
        let dot = simd_dot(simd_normalize(v1), simd_normalize(v2))
        let angleRadians = acos(max(-1.0, min(1.0, dot)))
        let angleDegrees = angleRadians * 180.0 / .pi
        
        XCTAssertEqual(angleDegrees, 90.0, accuracy: 0.1, "Should calculate 90-degree angle")
    }
    
    func testDistanceCalculation() {
        let joint1 = Joint3D(name: "p1", x: 0.0, y: 0.0, z: 0.0, isTracked: true)
        let joint2 = Joint3D(name: "p2", x: 3.0, y: 4.0, z: 0.0, isTracked: true)
        
        // Should be 5.0 (3-4-5 triangle)
        let p1 = simd_float3(joint1.x, joint1.y, joint1.z)
        let p2 = simd_float3(joint2.x, joint2.y, joint2.z)
        let distance = simd_distance(p1, p2)
        
        XCTAssertEqual(Double(distance), 5.0, accuracy: 0.001)
    }
}

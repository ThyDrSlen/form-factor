import ARKit
import Foundation

/**
 * Standalone Swift test for ARKit Body Tracking
 * 
 * Run this in Xcode to verify ARKit works independently of Expo:
 * 1. Open ios/formfactoreas.xcworkspace in Xcode
 * 2. Create new Swift file or use this one
 * 3. Add test function and call from AppDelegate
 */

class ARKitTest {
    static func testBodyTrackingSupport() {
        print("=== ARKit Body Tracking Test ===")
        
        // Test 1: Check if configuration is supported
        let isSupported = ARBodyTrackingConfiguration.isSupported
        print("✓ ARBodyTrackingConfiguration.isSupported: \(isSupported)")
        
        // Test 2: Check device capabilities
        if #available(iOS 13.0, *) {
            print("✓ iOS 13.0+ available")
        }
        
        // Test 3: Try to create configuration
        let config = ARBodyTrackingConfiguration()
        print("✓ Configuration created: \(config)")
        print("  - automaticImageScaleEstimationEnabled: \(config.automaticImageScaleEstimationEnabled)")
        
        if #available(iOS 14.0, *) {
            print("✓ iOS 14.0+ features available")
            print("  - automaticSkeletonScaleEstimationEnabled: \(config.automaticSkeletonScaleEstimationEnabled)")
        }
        
        // Test 4: Check available joint names
        let sampleJoints: [ARSkeleton.JointName] = [
            .root,
            .hips_joint,
            .left_upLeg_joint,
            .right_upLeg_joint
        ]
        print("✓ Sample joint names accessible: \(sampleJoints.count) joints")
        
        print("=== Test Complete ===")
        
        if !isSupported {
            print("⚠️  WARNING: Body tracking NOT supported on this device")
            print("   Requires: iPhone XS or newer (A12 Bionic+)")
        }
    }
}

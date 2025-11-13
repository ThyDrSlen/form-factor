import ExpoModulesCore
import ARKit
import RealityKit

public class ARKitBodyView: ExpoView {
  let arView = ARView(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    
    // Configure ARView - enable auto-config so ARView automatically displays camera feed
    // We'll still control the session configuration, but ARView will handle rendering
    arView.automaticallyConfigureSession = true
    arView.backgroundColor = .black
    
    // Ensure ARView is visible and properly configured
    arView.isHidden = false
    arView.alpha = 1.0
    
    addSubview(arView)
    
    // Expose this ARView's session to the module so tracking can reuse it
    ARKitBodyTrackerModule.sharedARView = arView
    
    print("[ARKitBodyView] ARView initialized and shared with automaticallyConfigureSession=true")
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
    print("[ARKitBodyView] Layout updated: \(bounds.width)x\(bounds.height)")
  }

  deinit {
    if ARKitBodyTrackerModule.sharedARView === arView {
      ARKitBodyTrackerModule.sharedARView = nil
      print("[ARKitBodyView] ARView deallocated")
    }
  }
}

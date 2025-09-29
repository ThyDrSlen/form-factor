#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

@interface VisionPoseDetector : FrameProcessorPlugin
@end

VISION_EXPORT_FRAME_PROCESSOR(VisionPoseDetector, detectPose)
 
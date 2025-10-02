#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import "formfactoreas-Swift.h"

@interface VisionPoseDetectorPlugin : FrameProcessorPlugin
@end

@implementation VisionPoseDetectorPlugin

- (id)callback:(Frame *)frame withArguments:(NSDictionary *)arguments {
  return [VisionPoseDetector callbackWithFrame:frame withArguments:arguments];
}

@end

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(VisionPoseDetectorPlugin, detectPose)

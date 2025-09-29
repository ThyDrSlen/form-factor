#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

@interface VisionPoseDetectorPlugin : NSObject
@end

@implementation VisionPoseDetectorPlugin

+ (void)load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"detectPose"
                                        withInitializer:^FrameProcessorPlugin*(NSDictionary* options) {
    return [[VisionPoseDetectorPlugin alloc] init];
  }];
}

- (id)callback:(Frame*)frame withArguments:(NSDictionary*)arguments {
  return [VisionPoseDetector callbackWithFrame:frame withArguments:arguments];
}

@end
 
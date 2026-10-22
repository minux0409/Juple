#import <Foundation/Foundation.h>
#import <JupleSpecs/JupleSpecs.h>
// The generated Swift header needs the RCTAppDelegate superclass declared first in Objective-C++.
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
// The generated Swift header declares ApnsBridge as a UNUserNotificationCenterDelegate.
#import <UserNotifications/UserNotifications.h>

#import "JupleMobile-Swift.h"

/// The JS side of links shared from other apps through the Juple Share extension (see ios/Shared/PendingShareStore.swift and
/// src/share/specs/NativeIncomingShareIOS.ts).
@interface JupleIncomingShareModule : NativeIncomingShareIOSSpecBase <NativeIncomingShareIOSSpec>
@end

@implementation JupleIncomingShareModule

RCT_EXPORT_MODULE(NativeIncomingShareIOS)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)getPendingSharesJson:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  // File coordination may wait for the extension's write: never on the JS thread's caller queue.
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    resolve([JuplePendingShareStore pendingSharesJSON]);
  });
}

- (void)acknowledgePendingShare:(NSString *)id resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [JuplePendingShareStore acknowledgeWithId:id];
    resolve(nil);
  });
}

- (void)setQuickSaveOnShare:(BOOL)enabled resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [JuplePendingShareStore setQuickSaveOnShare:enabled];
  resolve(nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeIncomingShareIOSSpecJSI>(params);
}

@end

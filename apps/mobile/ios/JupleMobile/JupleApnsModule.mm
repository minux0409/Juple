#import <Foundation/Foundation.h>
#import <JupleSpecs/JupleSpecs.h>
// See JupleCollectionShortcutsModule.mm: the generated Swift header needs the RCTAppDelegate superclass in Objective-C++.
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>

// The generated Swift header declares ApnsBridge as a UNUserNotificationCenterDelegate.
#import <UserNotifications/UserNotifications.h>
#import "JupleMobile-Swift.h"

/// The JS side of APNs (see ApnsBridge.swift and src/share/specs/NativeApnsIOS.ts).
@interface JupleApnsModule : NativeApnsIOSSpecBase <NativeApnsIOSSpec>
@end

@implementation JupleApnsModule

RCT_EXPORT_MODULE(NativeApnsIOS)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self selector:@selector(handleTokenChanged:) name:JupleApnsBridge.tokenChangedNotification object:nil];
    [center addObserver:self selector:@selector(handleForeground:) name:JupleApnsBridge.foregroundNotification object:nil];
    [center addObserver:self selector:@selector(handleOpened:) name:JupleApnsBridge.openedNotification object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)handleTokenChanged:(NSNotification *)notification
{
  if (_eventEmitterCallback) {
    [self emitOnTokenChanged:@""];
  }
}

- (void)handleForeground:(NSNotification *)notification
{
  NSString *message = notification.userInfo[@"message"];
  if (_eventEmitterCallback && message) {
    [self emitOnForegroundNotification:message];
  }
}

- (void)handleOpened:(NSNotification *)notification
{
  NSString *message = notification.userInfo[@"message"];
  // Before JS listens (a tap that launched the app) the tap stays in ApnsBridge for consumeInitialNotification.
  if (_eventEmitterCallback && message) {
    [self emitOnNotificationOpened:message];
    [JupleApnsBridge.shared markOpenedDelivered];
  }
}

- (void)registerForRemoteNotifications:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSString *environment = [JupleApnsBridge.shared environment];
  [JupleApnsBridge.shared registerWithCompletion:^(NSString *token, NSString *failure) {
    resolve(@{
      @"token" : token ?: (id)[NSNull null],
      @"environment" : environment,
      @"failure" : failure ?: (id)[NSNull null],
    });
  }];
}

- (void)consumeInitialNotification:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSString *message = [JupleApnsBridge.shared consumePendingOpened];
  resolve(message ?: (id)[NSNull null]);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeApnsIOSSpecJSI>(params);
}

@end

#import <Foundation/Foundation.h>
#import <JupleSpecs/JupleSpecs.h>
// The generated Swift header declares every @objc class of the app target, ReactNativeDelegate included. Its `@import` of
// React_RCTAppDelegate is skipped in Objective-C++ (no Clang modules), so the superclass is imported here explicitly.
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>

#import "JupleMobile-Swift.h"

/// The JS side of the iOS "컬렉션 열기" shortcut (see CollectionShortcuts.swift and NativeCollectionShortcutsIOS.ios.ts).
@interface JupleCollectionShortcutsModule : NativeCollectionShortcutsIOSSpecBase <NativeCollectionShortcutsIOSSpec>
@end

@implementation JupleCollectionShortcutsModule

RCT_EXPORT_MODULE(NativeCollectionShortcutsIOS)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleShortcutLaunch:)
                                                 name:JupleCollectionShortcutStore.launchNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)handleShortcutLaunch:(NSNotification *)notification
{
  // The launch itself stays stored until JS consumes it; this only wakes a running app. Before JS has subscribed there is
  // no callback yet - the launch is then picked up when the router mounts.
  if (_eventEmitterCallback) {
    [self emitOnShortcutLaunch:@""];
  }
}

- (void)consumeShortcutLaunch:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSNumber *collectionId = [JupleCollectionShortcutStore.shared consumePendingLaunch];
  resolve(@{
    @"openCollectionId" : collectionId ?: (id)[NSNull null],
    @"notice" : (id)[NSNull null],
  });
}

- (void)setShortcutCollections:(NSString *)collectionsJson
                       resolve:(RCTPromiseResolveBlock)resolve
                        reject:(RCTPromiseRejectBlock)reject
{
  if ([JupleCollectionShortcutStore.shared setChoicesWithJson:collectionsJson]) {
    resolve(nil);
  } else {
    reject(@"invalid_collections", @"The shortcut Collections could not be stored.", nil);
  }
}

- (void)getShortcutCollections:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([JupleCollectionShortcutStore.shared choicesJson]);
}

- (void)clearShortcutCollections:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [JupleCollectionShortcutStore.shared clear];
  resolve(nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeCollectionShortcutsIOSSpecJSI>(params);
}

@end

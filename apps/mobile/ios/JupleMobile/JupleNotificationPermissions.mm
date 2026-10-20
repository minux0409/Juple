#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>

static NSString *JupleNotificationStatus(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusAuthorized:
    case UNAuthorizationStatusProvisional:
    case UNAuthorizationStatusEphemeral: return @"granted";
    case UNAuthorizationStatusDenied: return @"denied";
    case UNAuthorizationStatusNotDetermined: return @"notDetermined";
  }
  return @"unavailable";
}
// Permission only. No Firebase initialization or remote/APNs registration.
@interface JupleNotificationPermissions : NSObject <RCTBridgeModule>
@end
@implementation JupleNotificationPermissions
RCT_EXPORT_MODULE(JupleNotificationPermissions)
+ (BOOL)requiresMainQueueSetup { return NO; }
RCT_EXPORT_METHOD(getStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    resolve(JupleNotificationStatus(settings.authorizationStatus));
  }];
}
RCT_EXPORT_METHOD(request:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionBadge | UNAuthorizationOptionSound) completionHandler:^(BOOL granted, NSError *error) {
    if (error) { resolve(@"unavailable"); return; }
    [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      resolve(JupleNotificationStatus(settings.authorizationStatus));
    }];
  }];
}
@end

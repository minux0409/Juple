import Foundation
import OSLog
import UIKit
import UserNotifications

/// The app's side of Apple Push (APNs), used by the NativeApnsIOS TurboModule (JupleApnsModule.mm). See docs/ios-apns-push.md.
///
/// - Device token: `register` asks UIKit for the APNs token; AppDelegate forwards didRegister/didFail here. The token is handed to JS as
///   a hex string, never logged. JS registers it with the backend only while notifications are allowed (pushRegistrationSync.ts).
/// - Environment: decided by the provisioning profile the app was signed with (its `aps-environment`), not by the build configuration.
/// - Notifications: this is the UNUserNotificationCenter delegate (set in AppDelegate before launch finishes, so a tap that launches the
///   app is delivered). A notification arriving in the foreground is handed to JS (the in-app banner) and not shown by the system; a tap
///   is handed to JS and also kept until JS takes it, so a tap that launched the app is not lost.
@objc(JupleApnsBridge)
public final class ApnsBridge: NSObject, UNUserNotificationCenterDelegate {
  @objc public static let shared = ApnsBridge()
  @objc public static let tokenChangedNotification = Notification.Name("JupleApnsTokenChanged")
  @objc public static let foregroundNotification = Notification.Name("JupleApnsForegroundNotification")
  @objc public static let openedNotification = Notification.Name("JupleApnsOpenedNotification")

  private static let log = Logger(subsystem: "com.juple.app", category: "apns")
  private static let registrationTimeout: TimeInterval = 20

  // Main thread only.
  private var waiting: [(String?, String?) -> Void] = []
  private var lastToken: String?
  private var pendingOpened: String?

  // MARK: Device token

  /// Calls back once with (hexToken, nil) or (nil, reason). Repeated calls while one is running share its result.
  @objc public func register(completion: @escaping (String?, String?) -> Void) {
    DispatchQueue.main.async {
      self.waiting.append(completion)
      guard self.waiting.count == 1 else { return }
      UIApplication.shared.registerForRemoteNotifications()
      DispatchQueue.main.asyncAfter(deadline: .now() + ApnsBridge.registrationTimeout) {
        if !self.waiting.isEmpty {
          ApnsBridge.log.error("APNs registration timed out")
          self.finish(token: nil, failure: "timeout")
        }
      }
    }
  }

  @objc public func didRegister(deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    DispatchQueue.main.async {
      let changed = self.lastToken != nil && self.lastToken != token
      self.lastToken = token
      ApnsBridge.log.info("APNs token received (\(token.count, privacy: .public) hex chars)")
      self.finish(token: token, failure: nil)
      if changed {
        NotificationCenter.default.post(name: ApnsBridge.tokenChangedNotification, object: nil)
      }
    }
  }

  @objc public func didFailToRegister(error: Error) {
    DispatchQueue.main.async {
      ApnsBridge.log.error("APNs registration failed: \((error as NSError).code, privacy: .public)")
      self.finish(token: nil, failure: "registrationFailed")
    }
  }

  private func finish(token: String?, failure: String?) {
    let callbacks = waiting
    waiting = []
    callbacks.forEach { $0(token, failure) }
  }

  /// "development" or "production": the `aps-environment` the app is signed for. A Simulator build always talks to the sandbox. An App
  /// Store / TestFlight install has no embedded.mobileprovision and is production.
  @objc public func environment() -> String {
    #if targetEnvironment(simulator)
      return "development"
    #else
      guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
        let data = try? Data(contentsOf: url),
        let start = data.range(of: Data("<?xml".utf8)),
        let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
        let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), format: nil)
          as? [String: Any],
        let entitlements = plist["Entitlements"] as? [String: Any],
        let value = entitlements["aps-environment"] as? String
      else {
        return "production"
      }
      return value == "development" ? "development" : "production"
    #endif
  }

  // MARK: Notifications

  /// The tap that is still waiting for JS (a tap that launched the app), taken once.
  @objc public func consumePendingOpened() -> String? {
    var value: String?
    let take = { value = self.pendingOpened; self.pendingOpened = nil }
    if Thread.isMainThread { take() } else { DispatchQueue.main.sync(execute: take) }
    return value
  }

  /// A delivered tap was handled by a running JS listener, so it must not be replayed as the launch tap.
  @objc public func markOpenedDelivered() {
    DispatchQueue.main.async { self.pendingOpened = nil }
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if let message = ApnsBridge.message(from: notification.request.content.userInfo) {
      ApnsBridge.log.info("APNs foreground notification forwarded")
      NotificationCenter.default.post(name: ApnsBridge.foregroundNotification, object: nil, userInfo: ["message": message])
    }
    // The app shows its own in-app banner while in front (as on Android); no system banner, sound or badge change here.
    completionHandler([])
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let message = ApnsBridge.message(from: response.notification.request.content.userInfo)
    {
      DispatchQueue.main.async {
        self.pendingOpened = message
        ApnsBridge.log.info("APNs notification tap forwarded")
        NotificationCenter.default.post(name: ApnsBridge.openedNotification, object: nil, userInfo: ["message": message])
      }
    }
    completionHandler()
  }

  /// `{"notification": {"title", "body"} | null, "data": {...}}` - the same shape as an Android FCM message, so the JS banner and tap
  /// routing are shared. `data` is every top-level key except `aps`, as strings (the backend sends strings only).
  static func message(from userInfo: [AnyHashable: Any]) -> String? {
    var data: [String: String] = [:]
    for (key, value) in userInfo {
      guard let key = key as? String, key != "aps" else { continue }
      if let string = value as? String {
        data[key] = string
      } else if let number = value as? NSNumber {
        data[key] = number.stringValue
      }
    }
    var notification: Any = NSNull()
    if let aps = userInfo["aps"] as? [String: Any] {
      if let alert = aps["alert"] as? [String: Any] {
        notification = ["title": alert["title"] as? String ?? "", "body": alert["body"] as? String ?? ""]
      } else if let alert = aps["alert"] as? String {
        notification = ["title": "", "body": alert]
      }
    }
    let payload: [String: Any] = ["notification": notification, "data": data]
    guard let json = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
    return String(data: json, encoding: .utf8)
  }
}

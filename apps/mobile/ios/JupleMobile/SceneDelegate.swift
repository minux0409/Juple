import UIKit
import React

// Owns the app window under the UIScene lifecycle. React Native itself (the factory and its
// React host) is created once in AppDelegate; a reconnecting scene only mounts a new root view
// on the existing host.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // launchOptions only seed a host that does not exist yet (Linking.getInitialURL reads them),
    // so a scene reconnecting to an already running host also forwards them as live events.
    let isFirstStart = !appDelegate.hasStartedReactNative
    appDelegate.hasStartedReactNative = true
    factory.startReactNative(
      withModuleName: "JupleMobile",
      in: window,
      launchOptions: Self.launchOptions(from: connectionOptions)
    )

    if !isFirstStart {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
      connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }
    }
  }

  // Custom-scheme URLs while running: the Entra OAuth redirect and app deep links.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      options[.openInPlace] = context.options.openInPlace
      _ = appDelegate.handleOpenURL(context.url, options: options)
    }
  }

  // Universal Links (https://<host>/c/{publicId}) while running.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }

  // Cold start: the scene receives the URL / user activity instead of the app's launchOptions.
  // Rebuild the keys RCTLinkingManager.getInitialURL reads so Linking.getInitialURL() keeps working.
  private static func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [AnyHashable: Any]? {
    if let url = connectionOptions.urlContexts.first?.url {
      return [UIApplication.LaunchOptionsKey.url.rawValue: url]
    }
    if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb && $0.webpageURL != nil
    }) {
      return [
        UIApplication.LaunchOptionsKey.userActivityDictionary.rawValue: [
          UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
          "UIApplicationLaunchOptionsUserActivityKey": activity,
        ]
      ]
    }
    return nil
  }
}

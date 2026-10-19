import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

// App-process setup only. The window and the React Native root view belong to the UIScene
// lifecycle (required from iOS 27) and are created in SceneDelegate, which reuses the single
// factory created here - React Native is never initialized twice.
@main
class AppDelegate: UIResponder, UIApplicationDelegate, RNAppAuthAuthorizationFlowManager {
  // Mirrors the scene's window (set by SceneDelegate) for code that still reads the delegate's window.
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  // Set by SceneDelegate once a root view has been mounted on the factory's React host.
  var hasStartedReactNative = false

  // Required by RNAppAuthAuthorizationFlowManager protocol
  public weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
  }

  // Resumes the Microsoft Entra External ID OAuth redirect (react-native-app-auth), otherwise
  // hands the URL to React Native Linking. Called by SceneDelegate for URLs opened while running.
  func handleOpenURL(_ url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    if let authorizationFlowManagerDelegate = self.authorizationFlowManagerDelegate,
      authorizationFlowManagerDelegate.resumeExternalUserAgentFlow(with: url)
    {
      return true
    }
    return RCTLinkingManager.application(UIApplication.shared, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

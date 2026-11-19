import Expo
import ExpoModulesCore
import React

/// Starts React Native, with no view, when iOS launches the app in the background
/// and connects no scene. Workaround for expo/expo#52878.
///
/// WHY. `ios.enableSceneSupport` (app.config.ts, required to launch on the iOS 27
/// SDK) removes `factory.startReactNative` from the generated AppDelegate; React
/// Native then starts only in `ExpoAppSceneDelegate.scene(_:willConnectTo:)`. A
/// silent push to a TERMINATED app relaunches it in the background with no scene,
/// so no JS ever runs: expo-task-manager queues the push for a task manager that
/// only JS registers, `local-operator.background-push` never runs, and the fetch
/// completion handler iOS passed is never called (agent review R1 M1). Before
/// scenes the AppDelegate started React Native on every launch, background ones
/// included, so this restores that behaviour for the one case scenes broke.
///
/// HOW. `RCTRootViewFactory.initializeReactHost` is RN's documented "initialize
/// React Host/Bridge without creating a view". It evaluates the bundle, whose
/// entry (`index.ts`) defines the task at module scope, so the queued push runs.
/// When a scene connects later, `startReactNative` → `viewWithModuleName` finds
/// the existing host and only adds a surface; on a normal launch the scene has
/// already started React Native and this does nothing.
///
/// TRIGGERS. (1) A silent push that arrives with no host and no connected scene:
/// iOS gives the fetch about 30 s, so waiting out the grace period would spend
/// it. (2) `gracePeriod` after launch with still no host, for any other
/// background relaunch (upstream's heuristic). `applicationState` cannot tell a
/// background launch apart: under scenes it is `.background` in
/// `didFinishLaunching` even on an icon tap.
///
/// LIMITS. No expo-updates in this app, so there is no launch asset to resolve
/// first (upstream notes apps WITH it must start `AppController` before this).
/// If a URL later foregrounds a host started here, `Linking.getInitialURL()`
/// lacks it (the host's launch options predate the scene); the scene still
/// forwards it as a `url` event, which the running JS receives.
///
/// The fetch completion itself is guaranteed separately, by the AppDelegate
/// deadline in `plugins/with-ios-background-fetch-deadline.js`.
///
/// REMOVE when Expo starts React Native for scene-less launches itself (an
/// upstream fix to expo/expo#52878, expected in SDK 58 or later): delete this
/// module, and check `scripts/ci/native-config.ts` `IOS_APP_DELEGATE_SUBSCRIBERS`.
public class LopBackgroundLaunchAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  /// Time UIKit gets to connect a scene (which starts React Native) on a normal
  /// launch. Upstream's value; a foreground launch connects its scene within
  /// the launch transaction, well inside it.
  private static let gracePeriod: TimeInterval = 2

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.gracePeriod) {
      Self.startHeadlessIfNeeded(reason: "no scene \(Int(Self.gracePeriod))s after launch")
    }
    return false
  }

  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    // Only when no scene exists: one that is connecting starts React Native
    // itself, with the launch options a cold URL needs.
    if application.connectedScenes.isEmpty {
      Self.startHeadlessIfNeeded(reason: "silent push with no scene")
    }
    // This subscriber does no fetch work. `.noData` is neutral in Expo's
    // aggregate (`newData` from any subscriber still wins), and expo-task-manager's
    // subscriber completes the push once the JS task finishes.
    completionHandler(.noData)
  }

  private static func startHeadlessIfNeeded(reason: String) {
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      let factory = provider.reactNativeFactory else {
      return
    }
    // "Has React Native started?" = does the factory hold a host (bridgeless,
    // RN's default) or a bridge (legacy). `reactHost` is read through KVC
    // because its type, RCTHost, is only forward-declared (`@class`) in
    // RCTRootViewFactory.h, so Swift does not import the property at all
    // (hosted build 44496198009: "value of type 'RCTRootViewFactory' has no
    // member 'reactHost'"). It is a plain Objective-C @property, so KVC reads
    // the same ivar (upstream's SDK 58 repro reads the property directly).
    let rootViewFactory = factory.rootViewFactory
    guard rootViewFactory.value(forKey: "reactHost") == nil, rootViewFactory.bridge == nil else {
      return
    }
    NSLog(
      "[LopBackgroundLaunch] %@ (connected scenes: %d); starting the React host without a view",
      reason,
      UIApplication.shared.connectedScenes.count
    )
    // `devMenuConfiguration` is nil in Release, and the initializer needs one.
    let devMenuConfiguration: RCTDevMenuConfiguration? =
      factory.devMenuConfiguration ?? RCTDevMenuConfiguration.default()
    factory.rootViewFactory.initializeReactHost(
      launchOptions: nil,
      bundleConfiguration: factory.bundleConfiguration,
      devMenuConfiguration: devMenuConfiguration ?? RCTDevMenuConfiguration()
    )
  }
}

import UIKit

// Only hosts the generated UI-test target. The unchanged installed Release app
// is addressed by bundle identifier in the test; this carrier never requests data.
@main
final class CarrierDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = UIViewController()
    window.rootViewController?.view.backgroundColor = .systemBackground
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}

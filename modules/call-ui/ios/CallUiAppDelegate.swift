import ExpoModulesCore
import UIKit

/// PushKit has to be registered while the app launches (also when iOS launches it in the background because of a VoIP push),
/// long before any JavaScript runs - so it is started from the app delegate, not from the JS module.
public class CallUiAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallUiCore.shared.start()
    return true
  }
}

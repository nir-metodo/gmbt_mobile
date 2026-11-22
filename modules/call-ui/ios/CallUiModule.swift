import ExpoModulesCore

/// JS side of the native incoming-call screen (iPhone: PushKit + CallKit, see CallUiCore).
public class CallUiModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CallUi")

    Events("onCallAnswered", "onCallEnded", "onCallMuted", "onVoipToken")

    OnCreate {
      CallUiCore.shared.start()
      CallUiCore.shared.module = self
    }

    OnDestroy {
      if CallUiCore.shared.module === self { CallUiCore.shared.module = nil }
    }

    Function("isSupported") { () -> Bool in
      return true
    }

    /// The PushKit token (hex) of this device, once iOS has issued it.
    Function("getVoipToken") { () -> String? in
      return CallUiCore.shared.currentToken()
    }

    /// Debug builds use the APNs sandbox, App Store / TestFlight / ad-hoc builds production.
    Function("isSandbox") { () -> Bool in
      #if DEBUG
      return true
      #else
      return false
      #endif
    }

    /// The "Answer" the user pressed on the system call screen (null when none / older than a minute). Read once.
    Function("consumePendingAction") { () -> [String: Any]? in
      return CallUiCore.shared.consumePending()
    }

    Function("hasPendingAction") { () -> Bool in
      return CallUiCore.shared.hasPending()
    }

    /// The call is over (SIP call ended / answered elsewhere): dismiss the system call.
    Function("cancelIncoming") { (callId: String?) -> Bool in
      CallUiCore.shared.endCalls(callId: callId)
      return true
    }

    Function("endCall") { (callId: String?) -> Bool in
      CallUiCore.shared.endCalls(callId: callId)
      return true
    }
  }
}

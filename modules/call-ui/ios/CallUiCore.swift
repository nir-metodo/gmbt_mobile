import Foundation
import PushKit
import CallKit
import AVFoundation
import ObjectiveC

/// iPhone side of "an incoming call always rings in the app":
///  - PushKit: the gateway sends a VoIP push when a call is about to ring an agent whose app is closed / locked;
///  - CallKit: the push MUST immediately be reported as an incoming call (the system call screen, also on the lock screen);
///  - "Answer" is stored for JavaScript, which registers to the phone system and answers the SIP call that arrives a moment later
///    (CallUiModule.consumePendingAction / the onCallAnswered event).
final class CallUiCore: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CallUiCore()

  private let tokenKey = "gambot_voip_token"
  private let pendingKey = "gambot_pending_answer"
  private let pendingTtlMs: Double = 60_000
  private let ringTimeoutSec: Double = 40

  private struct Info {
    let callId: String
    let from: String
    let name: String
    var answered: Bool
  }

  private var started = false
  private var registry: PKPushRegistry?
  private var provider: CXProvider?
  private let callController = CXCallController()
  private var calls: [UUID: Info] = [:]

  /// The JS module (only set while JavaScript is running) - events are lost otherwise, so everything is also stored for pickup.
  weak var module: CallUiModule?

  func start() {
    if started { return }
    started = true

    let config = CXProviderConfiguration()
    config.supportsVideo = false
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.phoneNumber, .generic]
    config.includesCallsInRecents = false
    let p = CXProvider(configuration: config)
    p.setDelegate(self, queue: DispatchQueue.main)
    provider = p

    let r = PKPushRegistry(queue: DispatchQueue.main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registry = r
  }

  // MARK: JS API

  func currentToken() -> String? {
    return UserDefaults.standard.string(forKey: tokenKey)
  }

  func consumePending() -> [String: Any]? {
    let d = UserDefaults.standard
    guard let dict = d.dictionary(forKey: pendingKey) else { return nil }
    d.removeObject(forKey: pendingKey)
    let at = (dict["at"] as? Double) ?? 0
    if Date().timeIntervalSince1970 * 1000 - at > pendingTtlMs { return nil }
    return dict
  }

  func hasPending() -> Bool {
    guard let dict = UserDefaults.standard.dictionary(forKey: pendingKey) else { return false }
    let at = (dict["at"] as? Double) ?? 0
    return Date().timeIntervalSince1970 * 1000 - at <= pendingTtlMs
  }

  /// Ends the system call (the SIP call ended / was answered elsewhere). `callId` nil or empty = every call.
  func endCalls(callId: String?) {
    for (uuid, info) in calls where (callId == nil || callId == "" || info.callId == callId) {
      let action = CXEndCallAction(call: uuid)
      callController.request(CXTransaction(action: action)) { _ in }
    }
  }

  // MARK: PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    UserDefaults.standard.set(token, forKey: tokenKey)
    module?.sendEvent("onVoipToken", ["token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    UserDefaults.standard.removeObject(forKey: tokenKey)
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else { completion(); return }
    let d = payload.dictionaryPayload
    let kind = (d["type"] as? String) ?? "incomingCall"
    let callId = (d["callId"] as? String) ?? ""
    let from = (d["from"] as? String) ?? ""
    let name = (d["name"] as? String) ?? ""

    if kind == "cancel" {
      handleCancel(callId: callId, completion: completion)
      return
    }
    var stale = false
    if let sent = (d["sentAt"] as? NSNumber)?.doubleValue {
      stale = Date().timeIntervalSince1970 * 1000 - sent > 45_000
    }
    reportIncoming(callId: callId, from: from, name: name, endImmediately: stale, completion: completion)
  }

  /// iOS kills an app that receives a VoIP push and does not report a call - so even a "stale" or "cancel" push is reported, then ended.
  private func reportIncoming(callId: String, from: String, name: String, endImmediately: Bool, completion: @escaping () -> Void) {
    guard let provider = provider else { completion(); return }
    let uuid = UUID()
    let update = CXCallUpdate()
    let shown = from.isEmpty ? "Gambot" : from
    update.remoteHandle = CXHandle(type: from.isEmpty ? .generic : .phoneNumber, value: shown)
    update.localizedCallerName = name.isEmpty ? shown : name
    update.hasVideo = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    calls[uuid] = Info(callId: callId, from: from, name: name, answered: false)

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      if error != nil {
        self?.calls.removeValue(forKey: uuid)
      } else if endImmediately {
        provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
        self?.calls.removeValue(forKey: uuid)
      } else {
        DispatchQueue.main.asyncAfter(deadline: .now() + (self?.ringTimeoutSec ?? 40)) { [weak self] in
          guard let self = self, let info = self.calls[uuid], !info.answered else { return }
          provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
          self.calls.removeValue(forKey: uuid)
        }
      }
      completion()
    }
  }

  private func handleCancel(callId: String, completion: @escaping () -> Void) {
    if let entry = calls.first(where: { $0.value.callId == callId }) {
      if !entry.value.answered {
        provider?.reportCall(with: entry.key, endedAt: nil, reason: .answeredElsewhere)
        calls.removeValue(forKey: entry.key)
      }
      completion()
      return
    }
    reportIncoming(callId: "", from: "", name: "", endImmediately: true, completion: completion)
  }

  // MARK: CallKit

  func providerDidReset(_ provider: CXProvider) {
    calls.removeAll()
    setManualAudio(false)
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    if var info = calls[action.callUUID] {
      info.answered = true
      calls[action.callUUID] = info
      // WebRTC must not touch the audio session by itself: CallKit hands it over in didActivate.
      setManualAudio(true)
      let pending: [String: Any] = [
        "action": "answer", "callId": info.callId, "from": info.from, "name": info.name,
        "at": Date().timeIntervalSince1970 * 1000,
      ]
      UserDefaults.standard.set(pending, forKey: pendingKey)
      module?.sendEvent("onCallAnswered", ["callId": info.callId, "from": info.from, "name": info.name])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    if let info = calls.removeValue(forKey: action.callUUID) {
      module?.sendEvent("onCallEnded", ["callId": info.callId, "answered": info.answered])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    module?.sendEvent("onCallMuted", ["muted": action.isMuted])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    guard let rtc = rtcAudioSession() else { return }
    let activate = NSSelectorFromString("audioSessionDidActivate:")
    if rtc.responds(to: activate) { _ = rtc.perform(activate, with: audioSession) }
    if rtc.responds(to: NSSelectorFromString("setIsAudioEnabled:")) { rtc.setValue(true, forKey: "isAudioEnabled") }
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    if let rtc = rtcAudioSession() {
      if rtc.responds(to: NSSelectorFromString("setIsAudioEnabled:")) { rtc.setValue(false, forKey: "isAudioEnabled") }
      let deactivate = NSSelectorFromString("audioSessionDidDeactivate:")
      if rtc.responds(to: deactivate) { _ = rtc.perform(deactivate, with: audioSession) }
    }
    setManualAudio(false)
  }

  // MARK: WebRTC audio session (react-native-webrtc's RTCAudioSession, reached through the ObjC runtime so this pod needs no WebRTC import)

  private func rtcAudioSession() -> NSObject? {
    guard let cls = NSClassFromString("RTCAudioSession") else { return nil }
    let sel = NSSelectorFromString("sharedInstance")
    guard let method = class_getClassMethod(cls, sel) else { return nil }
    typealias SharedInstanceFn = @convention(c) (AnyObject, Selector) -> Unmanaged<AnyObject>?
    let fn = unsafeBitCast(method_getImplementation(method), to: SharedInstanceFn.self)
    return fn(cls as AnyObject, sel)?.takeUnretainedValue() as? NSObject
  }

  private func setManualAudio(_ on: Bool) {
    guard let rtc = rtcAudioSession() else { return }
    if rtc.responds(to: NSSelectorFromString("setUseManualAudio:")) { rtc.setValue(on, forKey: "useManualAudio") }
    if rtc.responds(to: NSSelectorFromString("setIsAudioEnabled:")) { rtc.setValue(!on, forKey: "isAudioEnabled") }
  }
}

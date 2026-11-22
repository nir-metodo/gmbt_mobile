package com.gambot.callui

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Takes over FCM delivery from expo-notifications' service: "incomingCall" / "incomingCallCancel" data messages are handled here
 * (the app may be closed - the process is started by FCM for the high-priority message); anything else is passed on unchanged.
 */
class CallMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    // Expo's push service wraps the custom data of a push as a JSON string in "body".
    val payload: JSONObject? = try { data["body"]?.let { JSONObject(it) } } catch (e: Exception) { null }
    val type = payload?.optString("type") ?: data["type"]
    when (type) {
      "incomingCall" -> {
        val sentAt = payload?.optString("sentAt")?.toLongOrNull() ?: remoteMessage.sentTime
        val stale = sentAt > 0 && System.currentTimeMillis() - sentAt > 45_000
        // App open on screen: the in-app SIP phone rings by itself (and a second ring screen on top of it would be noise).
        if (!stale && !CallUi.isAppInForeground(this)) {
          CallUi.showIncoming(
            this,
            payload?.optString("callId") ?: data["callId"] ?: "",
            payload?.optString("name") ?: data["name"] ?: "",
            payload?.optString("from") ?: data["from"] ?: ""
          )
        }
        return
      }
      "incomingCallCancel" -> {
        CallUi.cancel(this, payload?.optString("callId") ?: data["callId"])
        return
      }
    }
    super.onMessageReceived(remoteMessage)
  }
}

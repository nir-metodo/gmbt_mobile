package com.gambot.callevents

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android-only module that surfaces device call events (missed / answered+ended, and
 * optionally outgoing) to JS / the backend. Detection itself happens in
 * [PhoneCallReceiver]; this module only stores the runtime config (auth token, org,
 * backend URL, enabled flag) that the receiver reads, and exposes a small pending-event
 * queue so JS can re-send events the receiver couldn't deliver (e.g. expired token).
 */
class CallEventsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallEvents")

    Function("isSupported") {
      true
    }

    Function("hasPermissions") {
      val ctx = appContext.reactContext ?: return@Function false
      hasPerm(ctx, Manifest.permission.READ_PHONE_STATE) &&
        hasPerm(ctx, Manifest.permission.READ_CALL_LOG)
    }

    AsyncFunction("requestPermissions") { promise: Promise ->
      val activity = appContext.activityProvider?.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val perms = arrayOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG
      )
      ActivityCompat.requestPermissions(activity, perms, PERMISSION_REQUEST_CODE)
      // The Android permission result is delivered to the Activity, not here. We resolve
      // optimistically; JS re-checks via hasPermissions() once the dialog is dismissed.
      promise.resolve(true)
    }

    Function("configure") { config: Map<String, Any?> ->
      appContext.reactContext?.let { ctx ->
        val editor = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        editor.putBoolean(KEY_ENABLED, (config["enabled"] as? Boolean) ?: false)
        editor.putString(KEY_BASE_URL, (config["baseUrl"] as? String) ?: "")
        editor.putString(KEY_TOKEN, (config["token"] as? String) ?: "")
        editor.putString(KEY_ORG, (config["organization"] as? String) ?: "")
        editor.putBoolean(KEY_REPORT_OUTGOING, (config["reportOutgoing"] as? Boolean) ?: false)
        editor.apply()
      }
    }

    Function("getPending") {
      val ctx = appContext.reactContext ?: return@Function ""
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PENDING, "") ?: ""
    }

    Function("clearPending") {
      appContext.reactContext
        ?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        ?.edit()
        ?.remove(KEY_PENDING)
        ?.apply()
    }
  }

  private fun hasPerm(ctx: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

  companion object {
    const val PREFS = "gambot_call_events"
    const val PERMISSION_REQUEST_CODE = 7321

    const val KEY_ENABLED = "enabled"
    const val KEY_BASE_URL = "baseUrl"
    const val KEY_TOKEN = "token"
    const val KEY_ORG = "organization"
    const val KEY_REPORT_OUTGOING = "reportOutgoing"
    const val KEY_PENDING = "pending"
  }
}

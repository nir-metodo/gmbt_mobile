package com.gambot.callevents

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.util.Log
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
        Manifest.permission.READ_PHONE_NUMBERS,
        Manifest.permission.READ_CALL_LOG
      )
      ActivityCompat.requestPermissions(activity, perms, PERMISSION_REQUEST_CODE)
      // The Android permission result is delivered to the Activity, not here. We resolve
      // optimistically; JS re-checks via hasPermissions() once the dialog is dismissed.
      promise.resolve(true)
    }

    Function("configure") { config: Map<String, Any?> ->
      appContext.reactContext?.let { ctx ->
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val enabled = (config["enabled"] as? Boolean) ?: false
        val editor = prefs.edit()
        editor.putBoolean(KEY_ENABLED, enabled)
        editor.putString(KEY_BASE_URL, (config["baseUrl"] as? String) ?: "")
        editor.putString(KEY_TOKEN, (config["token"] as? String) ?: "")
        // Refresh token + endpoint let the background sender renew an expired access token on its own.
        editor.putString(KEY_REFRESH_TOKEN, (config["refreshToken"] as? String) ?: "")
        editor.putString(KEY_REFRESH_URL, (config["refreshUrl"] as? String) ?: "")
        editor.putString(KEY_ORG, (config["organization"] as? String) ?: "")
        editor.putString(KEY_USER_ID, (config["userId"] as? String) ?: "")
        editor.putString(KEY_USER_NAME, (config["userName"] as? String) ?: "")
        editor.putString(KEY_SELF_NUMBER, (config["selfNumber"] as? String) ?: "")
        editor.putBoolean(KEY_REPORT_OUTGOING, (config["reportOutgoing"] as? Boolean) ?: false)
        if (enabled) {
          // Arm the scan floor the first time reporting is turned on so we never report calls that
          // happened before the user opted in. configure() runs on every foreground sync, so only
          // set it when missing — otherwise we'd keep pushing the floor forward and miss calls that
          // happened while the app was backgrounded.
          if (prefs.getLong(KEY_SCAN_FLOOR, 0L) == 0L) {
            editor.putLong(KEY_SCAN_FLOOR, System.currentTimeMillis())
          }
        } else {
          // Disabling re-arms the floor: a later re-enable will only report calls from that point on.
          editor.remove(KEY_SCAN_FLOOR)
        }
        editor.apply()

        // Watch the Call Log directly. This is what makes MISSED calls reliable: a missed call never
        // brings the app to the foreground (so the foreground scan wouldn't run) and the PHONE_STATE
        // broadcast is often suppressed by OEM background limits. The ContentObserver fires the instant
        // the OS writes the call row — while the app process is alive — so we report it immediately.
        if (enabled) {
          registerCallLogObserver(ctx.applicationContext)
          // Keep the process alive via a foreground service so detection works for HOURS while the
          // app is closed (the previous in-process-only observer died with the backgrounded process,
          // which is why calls only reached the server after re-opening the app). The periodic worker
          // self-heals the service if an aggressive OEM still kills it.
          CallMonitorService.start(ctx.applicationContext)
          CallMonitorScheduler.ensurePeriodic(ctx.applicationContext)
        } else {
          unregisterCallLogObserver(ctx.applicationContext)
          CallMonitorService.stop(ctx.applicationContext)
          CallMonitorScheduler.cancelPeriodic(ctx.applicationContext)
        }
      }
    }

    /** Whether the app is exempt from battery optimization (required for OEM background reliability). */
    Function("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext ?: return@Function false
      try {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        pm.isIgnoringBatteryOptimizations(ctx.packageName)
      } catch (e: Exception) {
        false
      }
    }

    /** Opens the system dialog asking the user to exempt the app from battery optimization. */
    AsyncFunction("requestIgnoreBatteryOptimizations") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) { promise.resolve(false); return@AsyncFunction }
      try {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        if (pm.isIgnoringBatteryOptimizations(ctx.packageName)) { promise.resolve(true); return@AsyncFunction }
        val intent = android.content.Intent(
          android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          android.net.Uri.parse("package:${ctx.packageName}")
        )
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }

    /** Reads finished calls from the system Call Log and reports any not-yet-sent ones. */
    AsyncFunction("scanRecentCalls") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      Thread {
        try {
          CallReporter.scan(ctx, waitForFresh = false)
          promise.resolve(true)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }.start()
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
    private const val TAG = "GambotCallEvents"

    const val PREFS = "gambot_call_events"
    const val PERMISSION_REQUEST_CODE = 7321

    const val KEY_ENABLED = "enabled"
    const val KEY_BASE_URL = "baseUrl"
    const val KEY_TOKEN = "token"
    const val KEY_REFRESH_TOKEN = "refreshToken"
    const val KEY_REFRESH_URL = "refreshUrl"
    const val KEY_ORG = "organization"
    const val KEY_USER_ID = "userId"
    const val KEY_USER_NAME = "userName"
    const val KEY_SELF_NUMBER = "selfNumber"
    const val KEY_REPORT_OUTGOING = "reportOutgoing"
    const val KEY_PENDING = "pending"
    const val KEY_SCAN_FLOOR = "scanFloor"
    const val KEY_SENT = "sentCallIds"

    @Volatile
    private var callLogObserver: ContentObserver? = null

    /** Idempotent: registers a single Call Log observer that scans on any change while the app lives. */
    @Synchronized
    fun registerCallLogObserver(appCtx: Context) {
      if (callLogObserver != null) return
      val obs = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) = onChange(selfChange, null)
        override fun onChange(selfChange: Boolean, uri: Uri?) {
          Thread {
            try { CallReporter.scan(appCtx, waitForFresh = false) } catch (_: Exception) {}
          }.start()
        }
      }
      try {
        appCtx.contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, obs)
        callLogObserver = obs
        Log.d(TAG, "Call Log observer registered")
      } catch (e: Exception) {
        Log.e(TAG, "Failed to register Call Log observer: ${e.message}")
      }
    }

    @Synchronized
    fun unregisterCallLogObserver(appCtx: Context) {
      val obs = callLogObserver ?: return
      try { appCtx.contentResolver.unregisterContentObserver(obs) } catch (_: Exception) {}
      callLogObserver = null
      Log.d(TAG, "Call Log observer unregistered")
    }
  }
}

package com.gambot.callevents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restarts call monitoring after a device reboot or an app update. Without this, the foreground
 * service would stay down until the user next opened the app — re-creating the exact "only works
 * after I open the app" bug after every reboot.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != Intent.ACTION_MY_PACKAGE_REPLACED &&
      action != "android.intent.action.QUICKBOOT_POWERON"
    ) return

    val prefs = context.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) return

    Log.d("GambotCallEvents", "BootReceiver: restarting call monitor after $action")
    try {
      CallMonitorService.start(context.applicationContext)
      CallMonitorScheduler.ensurePeriodic(context.applicationContext)
    } catch (e: Exception) {
      Log.e("GambotCallEvents", "BootReceiver start failed: ${e.message}")
    }
  }
}

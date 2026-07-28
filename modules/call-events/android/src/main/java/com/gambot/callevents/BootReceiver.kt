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
    // Always (re)schedule the WorkManager jobs first — this is allowed from the background even
    // when starting a foreground service isn't (e.g. after MY_PACKAGE_REPLACED on Android 12+).
    // The one-shot does an immediate Call Log scan so a call made right after an update is reported
    // within seconds, without waiting for the user to open the app or for the 15-min periodic tick.
    try {
      CallMonitorScheduler.ensurePeriodic(context.applicationContext)
      CallMonitorScheduler.runOnceNow(context.applicationContext)
    } catch (e: Exception) {
      Log.e("GambotCallEvents", "BootReceiver scheduler failed: ${e.message}")
    }
    // Best-effort: also try the always-on foreground service (may be blocked from background on
    // newer Android when triggered by an update — the WorkManager backup above covers that case).
    try {
      CallMonitorService.start(context.applicationContext)
    } catch (e: Exception) {
      Log.e("GambotCallEvents", "BootReceiver FGS start failed (WorkManager backup active): ${e.message}")
    }
  }
}

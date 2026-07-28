package com.gambot.callevents

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Self-heal layer for [CallMonitorService]. Aggressive OEMs may still kill a foreground service.
 * WorkManager periodic jobs are scheduled by the OS itself (JobScheduler) and survive process death,
 * so a periodic tick re-starts the service whenever it isn't running — and does a Call Log scan as a
 * backup. 15 minutes is the platform minimum for periodic work.
 */
object CallMonitorScheduler {
  private const val UNIQUE_PERIODIC = "gambot_call_monitor_periodic"
  private const val UNIQUE_ONESHOT = "gambot_call_monitor_oneshot"

  fun ensurePeriodic(ctx: Context) {
    val req = PeriodicWorkRequestBuilder<CallMonitorWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    // KEEP: don't reset the schedule if it already exists (avoids pushing the first run out repeatedly).
    WorkManager.getInstance(ctx.applicationContext)
      .enqueueUniquePeriodicWork(UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
  }

  fun cancelPeriodic(ctx: Context) {
    WorkManager.getInstance(ctx.applicationContext).cancelUniqueWork(UNIQUE_PERIODIC)
  }

  /**
   * Immediate one-shot catch-up. After an app update the OS blocks starting the foreground service
   * from the background, so instant (PHONE_STATE) detection can stay down until the user opens the
   * app once. Enqueuing a one-time WorkManager job IS allowed from the background and runs ASAP (no
   * 15-min floor) — it does a Call Log scan, so a call placed right after an update is reported
   * within seconds instead of waiting up to 15 minutes for the periodic tick.
   */
  fun runOnceNow(ctx: Context) {
    val req = OneTimeWorkRequestBuilder<CallMonitorWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(ctx.applicationContext)
      .enqueueUniqueWork(UNIQUE_ONESHOT, ExistingWorkPolicy.REPLACE, req)
  }
}

/** Periodic worker: re-ensures the monitor service is running and scans the Call Log as a backup. */
class CallMonitorWorker(appContext: Context, params: WorkerParameters) :
  Worker(appContext, params) {

  override fun doWork(): Result {
    return try {
      val prefs = applicationContext.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
      if (!prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) return Result.success()
      // Restart the foreground service if an OEM killed it.
      CallMonitorService.start(applicationContext)
      // Keep the access token fresh proactively (every ~15 min) so a backgrounded/long-idle device
      // never fails to report a call because its cached ~1h token expired. This is the scheduled
      // token refresh — device-side, using the long-lived refresh token.
      try { CallReporter.refreshTokenIfPossible(applicationContext) } catch (_: Exception) {}
      try { CallReporter.scan(applicationContext, waitForFresh = false) } catch (_: Exception) {}
      Result.success()
    } catch (e: Exception) {
      Result.retry()
    }
  }
}

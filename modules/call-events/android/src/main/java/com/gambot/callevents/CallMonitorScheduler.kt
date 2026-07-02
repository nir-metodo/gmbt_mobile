package com.gambot.callevents

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
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
      try { CallReporter.scan(applicationContext, waitForFresh = false) } catch (_: Exception) {}
      Result.success()
    } catch (e: Exception) {
      Result.retry()
    }
  }
}

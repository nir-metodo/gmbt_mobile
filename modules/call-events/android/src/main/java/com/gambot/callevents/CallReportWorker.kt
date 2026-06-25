package com.gambot.callevents

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * Runs the Call Log scan + network report off the BroadcastReceiver thread.
 *
 * [PhoneCallReceiver] only gets a ~10s window in `onReceive`, and the process it runs in may be
 * killed the instant that window closes. With token refresh now possibly adding a second network
 * round-trip, a slow network could blow that window and — if the app is never opened again — the
 * event would be lost forever. Enqueuing the work here instead makes delivery GUARANTEED: WorkManager
 * persists the request across process death, runs it expedited (≈immediately), waits for connectivity,
 * and retries with backoff on failure. The 5-minute freshness window in [CallReporter] still prevents
 * any stale/late delivery, so retries never turn into a confusing batch.
 */
class CallReportWorker(appContext: Context, params: WorkerParameters) :
  Worker(appContext, params) {

  override fun doWork(): Result {
    return try {
      val mode = inputData.getString(KEY_MODE) ?: MODE_SCAN
      if (mode == MODE_RING) {
        val number = inputData.getString(KEY_NUMBER) ?: ""
        CallReporter.reportIncomingRinging(applicationContext, number)
      } else {
        CallReporter.scan(applicationContext, waitForFresh = true)
      }
      Result.success()
    } catch (e: Exception) {
      Log.e(TAG, "CallReportWorker failed: ${e.message}")
      Result.retry()
    }
  }

  companion object {
    private const val TAG = "GambotCallEvents"
    const val KEY_MODE = "mode"
    const val KEY_NUMBER = "number"
    const val MODE_SCAN = "scan"
    const val MODE_RING = "ring"

    private val networkConstraint = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()

    /** Enqueue the "a call just ended → scan the Call Log and report it" job. */
    fun enqueueScan(ctx: Context) {
      val req = OneTimeWorkRequestBuilder<CallReportWorker>()
        .setInputData(workDataOf(KEY_MODE to MODE_SCAN))
        .setConstraints(networkConstraint)
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
        .build()
      // APPEND_OR_REPLACE: never cancel an in-flight send mid-network; queue the next scan after it.
      WorkManager.getInstance(ctx.applicationContext)
        .enqueueUniqueWork(UNIQUE_SCAN, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }

    /** Enqueue the "inbound call started ringing → emit incoming_call" job (number from the broadcast). */
    fun enqueueRing(ctx: Context, number: String) {
      val req = OneTimeWorkRequestBuilder<CallReportWorker>()
        .setInputData(workDataOf(KEY_MODE to MODE_RING, KEY_NUMBER to number))
        .setConstraints(networkConstraint)
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
        .build()
      WorkManager.getInstance(ctx.applicationContext).enqueue(req)
    }

    private const val UNIQUE_SCAN = "gambot_call_scan"
  }
}

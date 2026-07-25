package com.gambot.callevents

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Persistent foreground service that keeps the app process alive so call detection works even when
 * the user hasn't opened the app for hours.
 *
 * Why this is required: a missed/incoming call never brings the app to the foreground, and on modern
 * Android (8+) — especially OEMs like Xiaomi/MIUI, Samsung, Huawei, Oppo, Vivo — both the PHONE_STATE
 * broadcast receiver AND the in-process Call Log [android.database.ContentObserver] stop firing once
 * the OS kills the backgrounded process. The result was the reported bug: "called after 12h, nothing
 * reached the server — until I opened the app". A foreground service (with an ongoing notification)
 * is the only mechanism Android guarantees won't be killed, so the Call Log observer it registers
 * keeps reporting calls in real time regardless of whether the app is open.
 */
class CallMonitorService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startInForeground()
    // Keep the Call Log observer alive for the whole lifetime of this service (real-time reporting).
    CallEventsModule.registerCallLogObserver(applicationContext)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startInForeground()
    val prefs = applicationContext.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) {
      // Reporting was turned off — tear the service down so we don't keep a notification for nothing.
      stopSelfSafely()
      return START_NOT_STICKY
    }
    CallEventsModule.registerCallLogObserver(applicationContext)
    // Catch up on anything that happened while we were (re)starting, and refresh the token first so
    // the catch-up scan (and the next real-time call) sends with a valid, non-expired token.
    Thread {
      try { CallReporter.refreshTokenIfPossible(applicationContext) } catch (_: Exception) {}
      try { CallReporter.scan(applicationContext, waitForFresh = false) } catch (_: Exception) {}
    }.start()
    // START_STICKY: if the OS kills us under memory pressure, recreate the service when possible.
    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    // Re-arm via the periodic worker so an OEM kill self-heals on the next WorkManager tick.
    try {
      val prefs = applicationContext.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
      if (prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) {
        CallMonitorScheduler.ensurePeriodic(applicationContext)
      }
    } catch (_: Exception) {}
  }

  private fun startInForeground() {
    try {
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      Log.e(TAG, "startForeground failed: ${e.message}")
    }
  }

  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val existing = nm.getNotificationChannel(CHANNEL_ID)
      if (existing == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "ניטור שיחות",
          NotificationManager.IMPORTANCE_MIN
        ).apply {
          description = "שומר על דיווח שיחות פעיל גם כשהאפליקציה סגורה"
          setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
      }
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("דיווח שיחות פעיל")
      .setContentText("מזהה שיחות נכנסות ושיחות שלא נענו")
      .setSmallIcon(applicationInfo.icon)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .setShowWhen(false)
      .build()
  }

  private fun stopSelfSafely() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
    } catch (_: Exception) {}
    stopSelf()
  }

  companion object {
    private const val TAG = "GambotCallEvents"
    private const val CHANNEL_ID = "gambot_call_monitor"
    private const val NOTIFICATION_ID = 7322

    /** Start the foreground service (uses startForegroundService on O+). Safe to call repeatedly. */
    fun start(ctx: Context) {
      try {
        val intent = Intent(ctx, CallMonitorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
      } catch (e: Exception) {
        Log.e(TAG, "start service failed: ${e.message}")
      }
    }

    fun stop(ctx: Context) {
      try { ctx.stopService(Intent(ctx, CallMonitorService::class.java)) } catch (_: Exception) {}
    }
  }
}

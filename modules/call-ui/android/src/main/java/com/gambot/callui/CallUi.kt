package com.gambot.callui

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import java.util.Locale

/**
 * Everything native about the "incoming call" experience: the full-screen call notification, the pending
 * "answer" hand-over to JS, and the cancel. Shared by the messaging service, the call activity and the JS module.
 */
object CallUi {
  const val CHANNEL_ID = "gambot_incoming_call_v1"
  const val NOTIFICATION_ID = 7710
  const val ACTION_CANCEL = "com.gambot.callui.CANCEL"
  const val EXTRA_CALL_ID = "callId"
  const val EXTRA_FROM = "from"
  const val EXTRA_NAME = "name"
  const val EXTRA_BRIEF = "brief"
  const val EXTRA_ANSWER_NOW = "answerNow"
  private const val PREFS = "gambot_call_ui"
  private const val PENDING_TTL_MS = 60_000L
  private const val CALL_TTL_MS = 40_000L

  @Volatile
  var activeCallId: String? = null

  private fun isHebrew(): Boolean = Locale.getDefault().language.let { it == "he" || it == "iw" }
  fun tr(he: String, en: String): String = if (isHebrew()) he else en

  /** True while one of the app's activities is on screen (then JS rings through the SIP phone itself). */
  fun isAppInForeground(ctx: Context): Boolean {
    return try {
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val procs = am.runningAppProcesses ?: return false
      procs.any { it.processName == ctx.packageName && it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND }
    } catch (e: Exception) {
      false
    }
  }

  /** Creates the call channel if it does not exist yet (so its settings page can be opened before the first call). */
  fun ensureChannelPublic(ctx: Context) = ensureChannel(ctx)

  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val ch = NotificationChannel(CHANNEL_ID, tr("שיחות נכנסות", "Incoming calls"), NotificationManager.IMPORTANCE_HIGH)
    ch.description = tr("מסך שיחה נכנסת מהמרכזייה", "Incoming call screen from the phone system")
    ch.setSound(
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    )
    ch.enableVibration(true)
    ch.vibrationPattern = longArrayOf(0, 900, 700, 900, 700, 900, 700, 900)
    ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    ch.setShowBadge(false)
    nm.createNotificationChannel(ch)
  }

  private fun smallIcon(ctx: Context): Int {
    val id = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
    return if (id != 0) id else ctx.applicationInfo.icon
  }

  /** Shows the incoming call: heads-up while the phone is in use, the full-screen call screen when it is locked / off. */
  fun showIncoming(ctx: Context, callId: String, name: String, from: String, brief: List<String> = emptyList()) {
    if (callId.isNotEmpty() && activeCallId == callId) return
    activeCallId = callId
    ensureChannel(ctx)

    fun activityIntent(answerNow: Boolean) = Intent(ctx, IncomingCallActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(EXTRA_CALL_ID, callId); putExtra(EXTRA_FROM, from); putExtra(EXTRA_NAME, name); putExtra(EXTRA_BRIEF, ArrayList(brief)); putExtra(EXTRA_ANSWER_NOW, answerNow)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val screenPi = PendingIntent.getActivity(ctx, 9001, activityIntent(false), flags)
    val answerPi = PendingIntent.getActivity(ctx, 9002, activityIntent(true), flags)
    val declinePi = PendingIntent.getBroadcast(
      ctx, 9003,
      Intent(ctx, CallActionReceiver::class.java).putExtra(EXTRA_CALL_ID, callId), flags
    )

    val who = if (name.isNotBlank()) name else from
    val person = Person.Builder().setName(who.ifBlank { tr("שיחה נכנסת", "Incoming call") }).setImportant(true).build()
    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(smallIcon(ctx))
      .setContentTitle(who)
      .setContentText(
        if (brief.isNotEmpty()) brief.take(2).joinToString(" · ")
        else if (name.isNotBlank() && from.isNotBlank()) from else tr("שיחה נכנסת", "Incoming call")
      )
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(false)
      .setTimeoutAfter(CALL_TTL_MS)
      .setFullScreenIntent(screenPi, true)
      .setContentIntent(screenPi)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, declinePi, answerPi))
    val n = builder.build()
    n.flags = n.flags or Notification.FLAG_INSISTENT // the ringtone repeats until the call is answered / declined / cancelled

    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    try {
      nm.notify(NOTIFICATION_ID, n)
    } catch (e: SecurityException) {
      // notifications are blocked for the app: nothing we can show
      activeCallId = null
    }
  }

  /** Removes the notification and closes the call screen (the call was answered somewhere, ended, or declined here). */
  fun cancel(ctx: Context, callId: String?) {
    if (!callId.isNullOrEmpty() && activeCallId != null && activeCallId != callId) return // a different (newer) call is ringing
    activeCallId = null
    try {
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
    } catch (e: Exception) { /* ignore */ }
    ctx.sendBroadcast(Intent(ACTION_CANCEL).setPackage(ctx.packageName).putExtra(EXTRA_CALL_ID, callId ?: ""))
  }

  /** The user pressed Answer: remember it for JS (which registers to the PBX and answers the SIP call as soon as it arrives). */
  fun setPendingAnswer(ctx: Context, callId: String, from: String, name: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("callId", callId).putString("from", from).putString("name", name)
      .putLong("at", System.currentTimeMillis()).apply()
  }

  /** Returns (and clears) the answer the user chose on the native call screen, if it is still fresh. */
  fun consumePendingAnswer(ctx: Context): Map<String, Any?>? {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val at = p.getLong("at", 0L)
    val callId = p.getString("callId", null)
    val from = p.getString("from", "") ?: ""
    val name = p.getString("name", "") ?: ""
    p.edit().clear().apply()
    if (callId == null || at == 0L || System.currentTimeMillis() - at > PENDING_TTL_MS) return null
    return mapOf("action" to "answer", "callId" to callId, "from" to from, "name" to name, "at" to at.toDouble())
  }

  fun peekPendingAnswer(ctx: Context): Boolean {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val at = p.getLong("at", 0L)
    return at != 0L && System.currentTimeMillis() - at <= PENDING_TTL_MS && p.getString("callId", null) != null
  }

  fun launchApp(ctx: Context) {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    ctx.startActivity(intent)
  }
}

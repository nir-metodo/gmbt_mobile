package com.gambot.callevents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log

/**
 * Listens to PHONE_STATE changes purely as a real-time "a call just ended" signal. When the state
 * returns to IDLE we hand off to [CallReporter], which reads the finished call straight from the
 * system Call Log and reports it. We deliberately do NOT try to reconstruct the call from the
 * broadcast extras (EXTRA_INCOMING_NUMBER is frequently null on Android 10+, and the broadcast
 * itself is often suppressed by OEM background limits) — the Call Log is the reliable source, and
 * the same scan also runs whenever the app foregrounds, so events are never lost.
 */
class PhoneCallReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "onReceive fired: action=${intent.action}")
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

    val prefs = context.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
    val enabled = prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)
    val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
    Log.d(TAG, "PHONE_STATE: state=$stateStr enabled=$enabled")
    if (!enabled) return

    val state = when (stateStr) {
      TelephonyManager.EXTRA_STATE_RINGING -> STATE_RINGING
      TelephonyManager.EXTRA_STATE_OFFHOOK -> STATE_OFFHOOK
      TelephonyManager.EXTRA_STATE_IDLE -> STATE_IDLE
      else -> return
    }

    val lastState = prefs.getInt(KEY_LAST, STATE_IDLE)
    prefs.edit().putInt(KEY_LAST, state).apply()

    // Incoming call just started ringing → emit a real-time "incoming_call" event immediately, so
    // botomations can react the moment a call comes in (e.g. "Hi, we're also on WhatsApp") without
    // waiting for the call to end. This is a SEPARATE event (own callId) from the terminal
    // missed/answered event, so both fire and neither de-dupes the other. The caller number comes
    // from the broadcast (populated because we hold READ_CALL_LOG); outgoing calls go straight to
    // OFFHOOK and never ring, so this fires for inbound calls only.
    if (state == STATE_RINGING && lastState != STATE_RINGING) {
      val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)?.trim() ?: ""
      Log.d(TAG, "incoming ringing -> enqueue incoming_call (number present=${incomingNumber.isNotEmpty()})")
      // Hand off to WorkManager rather than doing the network call inside the ~10s broadcast window:
      // the work then completes even if this process is killed and the app is never reopened.
      CallReportWorker.enqueueRing(context.applicationContext, incomingNumber)
      return
    }

    // Only act on the transition INTO idle (a call just finished). Repeated/duplicate IDLE
    // broadcasts are ignored; CallReporter de-dupes anything that slips through anyway.
    if (state != STATE_IDLE || lastState == STATE_IDLE) return

    Log.d(TAG, "call ended -> enqueue Call Log scan")
    CallReportWorker.enqueueScan(context.applicationContext)
  }

  companion object {
    private const val TAG = "GambotCallEvents"

    private const val STATE_IDLE = 0
    private const val STATE_RINGING = 1
    private const val STATE_OFFHOOK = 2

    private const val KEY_LAST = "st_last"
  }
}

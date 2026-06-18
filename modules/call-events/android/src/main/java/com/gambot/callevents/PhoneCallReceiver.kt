package com.gambot.callevents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.telephony.TelephonyManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Tracks the device call state machine across PHONE_STATE broadcasts and reports terminal
 * events to the backend:
 *   - RINGING then IDLE (never OFFHOOK)        -> missed incoming
 *   - RINGING -> OFFHOOK -> IDLE               -> answered+ended incoming (with duration)
 *   - OFFHOOK (no preceding RINGING) -> IDLE   -> outgoing ended (bonus, only if reportOutgoing)
 *
 * Receiver instances are short-lived, so all transient state lives in SharedPreferences.
 * The network POST is done on a background thread kept alive via goAsync().
 */
class PhoneCallReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

    val prefs = context.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) return

    val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
    val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

    val state = when (stateStr) {
      TelephonyManager.EXTRA_STATE_RINGING -> STATE_RINGING
      TelephonyManager.EXTRA_STATE_OFFHOOK -> STATE_OFFHOOK
      TelephonyManager.EXTRA_STATE_IDLE -> STATE_IDLE
      else -> return
    }

    val lastState = prefs.getInt(KEY_LAST, STATE_IDLE)
    if (state == lastState) return // de-duplicate repeated broadcasts of the same state

    val editor = prefs.edit()
    var emit: Emit? = null

    when (state) {
      STATE_RINGING -> {
        editor.putBoolean(KEY_INCOMING, true)
        editor.putBoolean(KEY_OFFHOOK, false)
        editor.putLong(KEY_RING_START, System.currentTimeMillis())
        if (!incomingNumber.isNullOrEmpty()) editor.putString(KEY_NUMBER, incomingNumber)
      }
      STATE_OFFHOOK -> {
        if (lastState != STATE_RINGING) {
          // No ring preceded this -> outgoing call.
          editor.putBoolean(KEY_INCOMING, false)
          if (!incomingNumber.isNullOrEmpty()) editor.putString(KEY_NUMBER, incomingNumber)
        }
        editor.putBoolean(KEY_OFFHOOK, true)
        editor.putLong(KEY_OFFHOOK_START, System.currentTimeMillis())
      }
      STATE_IDLE -> {
        val isIncoming = prefs.getBoolean(KEY_INCOMING, false)
        val wasOffhook = prefs.getBoolean(KEY_OFFHOOK, false)
        val number = prefs.getString(KEY_NUMBER, "") ?: ""
        val reportOutgoing = prefs.getBoolean(CallEventsModule.KEY_REPORT_OUTGOING, false)

        if (isIncoming && !wasOffhook) {
          emit = Emit("missed", number, 0, true)
        } else if (isIncoming && wasOffhook) {
          val dur = durationSince(prefs.getLong(KEY_OFFHOOK_START, System.currentTimeMillis()))
          emit = Emit("answered", number, dur, true)
        } else if (!isIncoming && wasOffhook && reportOutgoing) {
          val dur = durationSince(prefs.getLong(KEY_OFFHOOK_START, System.currentTimeMillis()))
          emit = Emit("answered", number, dur, false)
        }

        // Reset the per-call transient state.
        editor.remove(KEY_INCOMING)
        editor.remove(KEY_OFFHOOK)
        editor.remove(KEY_NUMBER)
        editor.remove(KEY_RING_START)
        editor.remove(KEY_OFFHOOK_START)
      }
    }

    editor.putInt(KEY_LAST, state)
    editor.apply()

    val toSend = emit ?: return
    if (toSend.number.isEmpty()) return // backend requires a caller number; nothing to target

    val pendingResult = goAsync()
    Thread {
      try {
        send(prefs, toSend)
      } finally {
        pendingResult.finish()
      }
    }.start()
  }

  private fun durationSince(startMs: Long): Int =
    ((System.currentTimeMillis() - startMs) / 1000L).toInt().coerceAtLeast(0)

  private fun send(prefs: SharedPreferences, emit: Emit) {
    val baseUrl = (prefs.getString(CallEventsModule.KEY_BASE_URL, "") ?: "").trimEnd('/')
    val token = prefs.getString(CallEventsModule.KEY_TOKEN, "") ?: ""
    val org = prefs.getString(CallEventsModule.KEY_ORG, "") ?: ""
    if (baseUrl.isEmpty() || org.isEmpty()) return

    val json = JSONObject().apply {
      put("organization", org)
      put("callType", emit.type)
      put("callerPhone", emit.number)
      put("callId", UUID.randomUUID().toString().replace("-", ""))
      put("durationSeconds", emit.durationSec)
      put("direction", if (emit.incoming) "inbound" else "outbound")
      put("source", "device")
    }
    val body = json.toString()

    var ok = false
    try {
      val conn = URL("$baseUrl/api/Webhooks/ReportDeviceCallEvent").openConnection() as HttpURLConnection
      conn.requestMethod = "POST"
      conn.connectTimeout = 15000
      conn.readTimeout = 15000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      if (token.isNotEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
      conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      ok = conn.responseCode in 200..299
      conn.disconnect()
    } catch (e: Exception) {
      ok = false
    }

    if (!ok) {
      // Couldn't deliver (offline / expired token). Queue it for JS to flush with a fresh token.
      synchronized(LOCK) {
        val existing = prefs.getString(CallEventsModule.KEY_PENDING, "") ?: ""
        val merged = if (existing.isEmpty()) body else "$existing\n$body"
        prefs.edit().putString(CallEventsModule.KEY_PENDING, merged).apply()
      }
    }
  }

  private data class Emit(val type: String, val number: String, val durationSec: Int, val incoming: Boolean)

  companion object {
    private val LOCK = Any()

    private const val STATE_IDLE = 0
    private const val STATE_RINGING = 1
    private const val STATE_OFFHOOK = 2

    private const val KEY_LAST = "st_last"
    private const val KEY_INCOMING = "st_incoming"
    private const val KEY_OFFHOOK = "st_offhook"
    private const val KEY_NUMBER = "st_number"
    private const val KEY_RING_START = "st_ring_start"
    private const val KEY_OFFHOOK_START = "st_offhook_start"
  }
}

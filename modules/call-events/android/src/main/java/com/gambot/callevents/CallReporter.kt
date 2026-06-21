package com.gambot.callevents

import android.content.Context
import android.content.SharedPreferences
import android.provider.CallLog
import android.telephony.TelephonyManager
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The single source of truth for device call events.
 *
 * Instead of trying to reconstruct each call from the (unreliable, OEM-throttled) PHONE_STATE
 * broadcast, we read finished calls straight from the system Call Log and report any we haven't
 * sent yet. This is invoked from two places:
 *   1. [PhoneCallReceiver] in real time, the moment a call ends (state -> IDLE), and
 *   2. every time the app comes to the foreground (JS -> CallEvents.scanRecentCalls()).
 *
 * (2) is the important reliability win: many OEMs (Xiaomi/MIUI, Samsung, Huawei, Oppo, Vivo)
 * silently suppress background broadcast receivers, so the real-time path may never fire. The
 * foreground scan guarantees the call is still reported as soon as the user opens the app.
 *
 * Duplicates across the two paths (and across retries) are prevented by a deterministic callId
 * ("dev_{digits}_{callStartMs}") plus a persisted "already sent" set. The backend also de-dupes
 * by callId as a final guard against at-least-once delivery.
 */
object CallReporter {
  private const val TAG = "GambotCallEvents"
  private val LOCK = Any()
  private const val MAX_LOOKBACK_MS = 24L * 60 * 60 * 1000 // never look further back than 24h
  private const val SENT_CAP = 300

  /**
   * @param waitForFresh when true (real-time receiver path) retry briefly, because the OS may not
   *   have written the Call Log row for the just-ended call yet. When false (foreground scan) we
   *   do a single pass since the rows have long settled.
   */
  fun scan(ctx: Context, waitForFresh: Boolean) {
    val prefs = ctx.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) {
      Log.d(TAG, "scan skipped: reporting disabled")
      return
    }
    val baseUrl = (prefs.getString(CallEventsModule.KEY_BASE_URL, "") ?: "").trimEnd('/')
    val org = prefs.getString(CallEventsModule.KEY_ORG, "") ?: ""
    if (baseUrl.isEmpty() || org.isEmpty()) {
      Log.d(TAG, "scan abort: missing baseUrl/org")
      return
    }

    // Don't report while a call is still ringing/active. Some OEMs write the Call Log row (and fire
    // the observer) the moment the call starts, which produced a premature "missed, 0s" record while
    // the phone was still ringing. We only report once the device is back to IDLE — i.e. the call has
    // truly ended — so the row carries its final type (missed vs answered) and duration. The IDLE
    // PHONE_STATE receiver + the next foreground scan guarantee we still catch it the moment it ends.
    if (callInProgress(ctx)) {
      Log.d(TAG, "scan skipped: a call is still in progress; will report once it ends")
      return
    }

    val reportOutgoing = prefs.getBoolean(CallEventsModule.KEY_REPORT_OUTGOING, false)
    val floor = prefs.getLong(CallEventsModule.KEY_SCAN_FLOOR, 0L)
    // Only ever report calls that happened after the user turned reporting on, and never more than
    // 24h back, so first-enable / reinstall never floods the org with historical calls.
    val since = maxOf(floor, System.currentTimeMillis() - MAX_LOOKBACK_MS)

    // The "to" of an incoming call = the agent's own line. Prefer the number from the logged-in
    // profile (pushed via configure); fall back to the device's own line number when available.
    val selfNumber = prefs.getString(CallEventsModule.KEY_SELF_NUMBER, "") ?: ""
    val calledNumber = if (selfNumber.isNotEmpty()) selfNumber else deviceLine1(ctx)

    synchronized(LOCK) {
      val attempts = if (waitForFresh) 6 else 1
      repeat(attempts) { attempt ->
        val rows = queryCalls(ctx, since)
        Log.d(TAG, "scan attempt ${attempt + 1}/$attempts: ${rows.size} row(s) since=$since")
        var sentAny = false
        for (row in rows) {
          val callType = mapType(row.type, reportOutgoing) ?: continue
          if (row.number.isEmpty()) continue
          val incoming = row.type != CallLog.Calls.OUTGOING_TYPE
          val callId = "dev_${digits(row.number)}_${row.dateMs}"
          if (isSent(prefs, callId)) continue
          val ok = send(prefs, baseUrl, org, callType, row.number, calledNumber, callId, row.durationSec, incoming)
          if (ok) {
            markSent(prefs, callId)
            sentAny = true
            Log.d(TAG, "reported $callType from CallLog (callId=$callId)")
          }
        }
        if (sentAny || !waitForFresh) return
        try { Thread.sleep(400) } catch (e: InterruptedException) { return }
      }
    }
  }

  /**
   * Emit a real-time "incoming_call" event the moment an inbound call starts ringing. Uses a callId
   * distinct from the terminal missed/answered event ("dev_ring_..." vs "dev_...") so the backend
   * de-dupe never collapses the two — both events fire for the same physical call.
   */
  fun reportIncomingRinging(ctx: Context, rawNumber: String) {
    val prefs = ctx.getSharedPreferences(CallEventsModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(CallEventsModule.KEY_ENABLED, false)) {
      Log.d(TAG, "incoming ringing skipped: reporting disabled")
      return
    }
    val baseUrl = (prefs.getString(CallEventsModule.KEY_BASE_URL, "") ?: "").trimEnd('/')
    val org = prefs.getString(CallEventsModule.KEY_ORG, "") ?: ""
    if (baseUrl.isEmpty() || org.isEmpty()) {
      Log.d(TAG, "incoming ringing abort: missing baseUrl/org")
      return
    }
    val number = rawNumber.trim()
    if (number.isEmpty()) {
      // No caller number at ring time (some OEMs withhold it); the terminal event still fires on hang-up.
      Log.d(TAG, "incoming ringing: caller number unavailable, skipping incoming_call event")
      return
    }
    val selfNumber = prefs.getString(CallEventsModule.KEY_SELF_NUMBER, "") ?: ""
    val calledNumber = if (selfNumber.isNotEmpty()) selfNumber else deviceLine1(ctx)
    val callId = "dev_ring_${digits(number)}_${System.currentTimeMillis()}"
    synchronized(LOCK) {
      if (isSent(prefs, callId)) return
      val ok = send(prefs, baseUrl, org, "incoming", number, calledNumber, callId, 0, true)
      if (ok) {
        markSent(prefs, callId)
        Log.d(TAG, "reported incoming_call (callId=$callId)")
      }
    }
  }

  /** True while the phone is ringing or on a call — i.e. the current call hasn't finished yet. */
  private fun callInProgress(ctx: Context): Boolean = try {
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    (tm?.callState ?: TelephonyManager.CALL_STATE_IDLE) != TelephonyManager.CALL_STATE_IDLE
  } catch (e: Exception) {
    false
  }

  /** Best-effort read of the device's own line number (often empty without a provisioned SIM number). */
  private fun deviceLine1(ctx: Context): String = try {
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    (tm?.line1Number ?: "").trim()
  } catch (e: Exception) {
    ""
  }

  private data class Row(val number: String, val type: Int, val dateMs: Long, val durationSec: Int)

  private fun queryCalls(ctx: Context, sinceMs: Long): List<Row> {
    val out = ArrayList<Row>()
    try {
      ctx.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
        "${CallLog.Calls.DATE} >= ?",
        arrayOf(sinceMs.toString()),
        "${CallLog.Calls.DATE} DESC"
      )?.use { c ->
        val iNum = c.getColumnIndex(CallLog.Calls.NUMBER)
        val iType = c.getColumnIndex(CallLog.Calls.TYPE)
        val iDate = c.getColumnIndex(CallLog.Calls.DATE)
        val iDur = c.getColumnIndex(CallLog.Calls.DURATION)
        var count = 0
        while (c.moveToNext() && count < 25) {
          count++
          val num = if (iNum >= 0) (c.getString(iNum) ?: "") else ""
          val type = if (iType >= 0) c.getInt(iType) else -1
          val date = if (iDate >= 0) c.getLong(iDate) else 0L
          val dur = if (iDur >= 0) c.getInt(iDur) else 0
          out.add(Row(num.trim(), type, date, dur))
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "CallLog query failed (READ_CALL_LOG missing?): ${e.message}")
    }
    return out
  }

  /** Maps an Android CallLog type to our backend callType, or null for types we don't report. */
  private fun mapType(type: Int, reportOutgoing: Boolean): String? = when (type) {
    CallLog.Calls.MISSED_TYPE -> "missed"
    CallLog.Calls.REJECTED_TYPE -> "missed"
    CallLog.Calls.INCOMING_TYPE -> "answered"
    CallLog.Calls.OUTGOING_TYPE -> if (reportOutgoing) "answered" else null
    else -> null // voicemail / blocked / unknown
  }

  private fun digits(s: String): String = s.filter { it.isDigit() }.ifEmpty { "x" }

  private fun isSent(prefs: SharedPreferences, callId: String): Boolean {
    val raw = prefs.getString(CallEventsModule.KEY_SENT, "") ?: ""
    if (raw.isEmpty()) return false
    return raw.split('\n').contains(callId)
  }

  private fun markSent(prefs: SharedPreferences, callId: String) {
    val raw = prefs.getString(CallEventsModule.KEY_SENT, "") ?: ""
    val list = raw.split('\n').filter { it.isNotEmpty() }.toMutableList()
    if (list.contains(callId)) return
    list.add(callId)
    val capped = if (list.size > SENT_CAP) list.subList(list.size - SENT_CAP, list.size) else list
    prefs.edit().putString(CallEventsModule.KEY_SENT, capped.joinToString("\n")).apply()
  }

  private fun send(
    prefs: SharedPreferences,
    baseUrl: String,
    org: String,
    callType: String,
    number: String,
    calledNumber: String,
    callId: String,
    durationSec: Int,
    incoming: Boolean
  ): Boolean {
    val token = prefs.getString(CallEventsModule.KEY_TOKEN, "") ?: ""
    val userId = prefs.getString(CallEventsModule.KEY_USER_ID, "") ?: ""
    val userName = prefs.getString(CallEventsModule.KEY_USER_NAME, "") ?: ""

    val json = JSONObject().apply {
      put("organization", org)
      put("callType", callType)
      put("callerPhone", number)
      put("calledNumber", calledNumber)
      put("callId", callId)
      put("durationSeconds", durationSec)
      put("direction", if (incoming) "inbound" else "outbound")
      put("source", "device")
      put("appUserId", userId)
      put("appUserName", userName)
    }
    val body = json.toString()

    return try {
      val conn = URL("$baseUrl/api/Webhooks/ReportDeviceCallEvent").openConnection() as HttpURLConnection
      conn.requestMethod = "POST"
      conn.connectTimeout = 15000
      conn.readTimeout = 15000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      if (token.isNotEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
      conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val code = conn.responseCode
      conn.disconnect()
      Log.d(TAG, "POST ReportDeviceCallEvent -> HTTP $code (callId=$callId)")
      if (code in 200..299) {
        true
      } else {
        // Likely an expired token while the app was killed. Queue for JS to re-send with a fresh one.
        queuePending(prefs, body)
        false
      }
    } catch (e: Exception) {
      Log.e(TAG, "POST ReportDeviceCallEvent failed: ${e.message}")
      queuePending(prefs, body)
      false
    }
  }

  private fun queuePending(prefs: SharedPreferences, body: String) {
    val existing = prefs.getString(CallEventsModule.KEY_PENDING, "") ?: ""
    val merged = if (existing.isEmpty()) body else "$existing\n$body"
    prefs.edit().putString(CallEventsModule.KEY_PENDING, merged).apply()
  }
}

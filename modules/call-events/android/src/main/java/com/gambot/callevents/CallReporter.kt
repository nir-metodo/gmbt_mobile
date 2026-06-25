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
  // Only report a finished call if it ended within this window. The real-time IDLE broadcast is
  // frequently suppressed by OEM background limits (Xiaomi/Samsung/Huawei/…); when that happens the
  // call would otherwise only be picked up by a later foreground/periodic scan and fire HOURS later
  // as a confusing batch ("all of them at once"). Per product requirement: if a call isn't reported
  // right after it ends, we skip it entirely rather than send a stale notification.
  private const val FRESH_WINDOW_MS = 5L * 60 * 1000 // 5 minutes

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
        val now = System.currentTimeMillis()
        val rows = queryCalls(ctx, since)
        Log.d(TAG, "scan attempt ${attempt + 1}/$attempts: ${rows.size} row(s) since=$since")
        var sentAny = false
        for (row in rows) {
          val callType = mapType(row.type, reportOutgoing) ?: continue
          if (row.number.isEmpty()) continue
          // Skip stale calls: if it didn't get reported in real time (OEM suppressed the broadcast) and
          // we only see it now — hours later, on a foreground/periodic scan — don't fire a late batch.
          val callEndMs = row.dateMs + row.durationSec * 1000L
          val ageMs = now - callEndMs
          if (ageMs > FRESH_WINDOW_MS) {
            Log.d(TAG, "skip stale call: ended ${ageMs / 1000}s ago (> ${FRESH_WINDOW_MS / 1000}s window) number=${digits(row.number)}")
            continue
          }
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

    var code = postEvent(baseUrl, token, body)
    Log.d(TAG, "POST ReportDeviceCallEvent -> HTTP $code (callId=$callId)")

    // The stored Firebase access token expires ~1h after login. When a call ends while the app has
    // been closed/backgrounded past that, the POST 401/403s. Instead of deferring to the next app
    // open (which produced the confusing late batch), mint a fresh token right here via the refresh
    // token and retry once — so real-time reporting keeps working even after long inactivity.
    if (code == 401 || code == 403) {
      val fresh = refreshAccessToken(prefs)
      if (!fresh.isNullOrEmpty()) {
        code = postEvent(baseUrl, fresh, body)
        Log.d(TAG, "POST retry after token refresh -> HTTP $code (callId=$callId)")
      }
    }

    return if (code in 200..299) {
      true
    } else {
      // Refresh unavailable/failed or network down — queue for JS to re-send with a fresh token.
      queuePending(prefs, body)
      false
    }
  }

  /** POSTs the event body with the given bearer token. Returns the HTTP status code, or -1 on error. */
  private fun postEvent(baseUrl: String, token: String, body: String): Int {
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
      code
    } catch (e: Exception) {
      Log.e(TAG, "POST ReportDeviceCallEvent failed: ${e.message}")
      -1
    }
  }

  /**
   * Exchanges the stored long-lived refresh token for a fresh access token (same endpoint the JS
   * axios layer uses) and persists it to KEY_TOKEN. Returns the new token, or null if unavailable.
   */
  private fun refreshAccessToken(prefs: SharedPreferences): String? {
    val refreshToken = prefs.getString(CallEventsModule.KEY_REFRESH_TOKEN, "") ?: ""
    val refreshUrl = prefs.getString(CallEventsModule.KEY_REFRESH_URL, "") ?: ""
    if (refreshToken.isEmpty() || refreshUrl.isEmpty()) {
      Log.d(TAG, "token refresh skipped: no refresh token/url configured")
      return null
    }
    return try {
      val conn = URL(refreshUrl).openConnection() as HttpURLConnection
      conn.requestMethod = "POST"
      conn.connectTimeout = 15000
      conn.readTimeout = 15000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      val reqBody = JSONObject().put("refreshToken", refreshToken).toString()
      conn.outputStream.use { it.write(reqBody.toByteArray(Charsets.UTF_8)) }
      val httpCode = conn.responseCode
      val respText = if (httpCode in 200..299)
        conn.inputStream.bufferedReader().use { it.readText() }
      else ""
      conn.disconnect()
      if (httpCode in 200..299 && respText.isNotEmpty()) {
        val idToken = JSONObject(respText).optString("IdToken", "")
        if (idToken.isNotEmpty()) {
          prefs.edit().putString(CallEventsModule.KEY_TOKEN, idToken).apply()
          Log.d(TAG, "background token refresh succeeded")
          idToken
        } else {
          Log.d(TAG, "token refresh: no IdToken in response")
          null
        }
      } else {
        Log.d(TAG, "token refresh failed: HTTP $httpCode")
        null
      }
    } catch (e: Exception) {
      Log.e(TAG, "token refresh error: ${e.message}")
      null
    }
  }

  private fun queuePending(prefs: SharedPreferences, body: String) {
    val existing = prefs.getString(CallEventsModule.KEY_PENDING, "") ?: ""
    val merged = if (existing.isEmpty()) body else "$existing\n$body"
    prefs.edit().putString(CallEventsModule.KEY_PENDING, merged).apply()
  }
}

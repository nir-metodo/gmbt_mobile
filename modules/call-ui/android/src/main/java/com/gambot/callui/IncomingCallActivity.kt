package com.gambot.callui

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * The full-screen "incoming call" the user sees when the phone is locked / the app is closed: caller name + number, big green
 * Answer and red Decline. Answer unlocks the phone and opens the app, which registers to the phone system and answers the call
 * (JS reads the choice with CallUi.consumePendingAction). The ring itself is the notification's sound.
 */
class IncomingCallActivity : Activity() {
  private var callId = ""
  private var from = ""
  private var name = ""
  private val handler = Handler(Looper.getMainLooper())
  private var done = false
  private var answering = false

  private val cancelReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (answering) return // our own cancel (the ring stops when Answer is pressed); this screen closes itself when the app opens
      val id = intent.getStringExtra(CallUi.EXTRA_CALL_ID) ?: ""
      if (id.isEmpty() || callId.isEmpty() || id == callId) finishCall()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    readIntent(intent)
    ContextCompat.registerReceiver(this, cancelReceiver, IntentFilter(CallUi.ACTION_CANCEL), ContextCompat.RECEIVER_NOT_EXPORTED)

    if (intent.getBooleanExtra(CallUi.EXTRA_ANSWER_NOW, false)) { answer(); return }
    setContentView(buildUi())
    handler.postDelayed({ finishCall() }, 40_000) // the PBX gave up long ago
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    readIntent(intent)
    if (intent.getBooleanExtra(CallUi.EXTRA_ANSWER_NOW, false)) answer()
  }

  private fun readIntent(i: Intent) {
    callId = i.getStringExtra(CallUi.EXTRA_CALL_ID) ?: ""
    from = i.getStringExtra(CallUi.EXTRA_FROM) ?: ""
    name = i.getStringExtra(CallUi.EXTRA_NAME) ?: ""
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    try { unregisterReceiver(cancelReceiver) } catch (e: Exception) { /* ignore */ }
    super.onDestroy()
  }

  private fun finishCall() {
    if (done) return
    done = true
    if (!isFinishing) finish()
  }

  private fun answer() {
    if (done || answering) return
    answering = true
    CallUi.setPendingAnswer(this, callId, from, name)
    CallUi.cancel(this, callId) // stops the ring + notification
    val launch = { CallUi.launchApp(applicationContext); finishCall() }
    val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (km.isKeyguardLocked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() { launch() }
        override fun onDismissCancelled() { CallUi.consumePendingAnswer(applicationContext); finishCall() } // the user did not unlock
        override fun onDismissError() { launch() }
      })
    } else launch()
  }

  private fun decline() {
    CallUi.cancel(this, callId)
    finishCall()
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun circle(color: Int, label: String, glyph: String, onClick: () -> Unit): LinearLayout {
    val col = LinearLayout(this)
    col.orientation = LinearLayout.VERTICAL
    col.gravity = Gravity.CENTER_HORIZONTAL
    val btn = TextView(this)
    btn.text = glyph
    btn.textSize = 30f
    btn.setTextColor(Color.WHITE)
    btn.gravity = Gravity.CENTER
    btn.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
    btn.layoutParams = LinearLayout.LayoutParams(dp(78), dp(78))
    btn.setOnClickListener { onClick() }
    btn.elevation = dp(6).toFloat()
    val tv = TextView(this)
    tv.text = label
    tv.setTextColor(Color.WHITE)
    tv.textSize = 15f
    tv.gravity = Gravity.CENTER
    tv.setPadding(0, dp(10), 0, 0)
    col.addView(btn)
    col.addView(tv)
    return col
  }

  private fun buildUi(): View {
    val root = FrameLayout(this)
    root.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor("#1f4439"), Color.parseColor("#0e1f1a")))

    val column = LinearLayout(this)
    column.orientation = LinearLayout.VERTICAL
    column.gravity = Gravity.CENTER_HORIZONTAL
    column.setPadding(dp(24), dp(72), dp(24), dp(56))

    val brand = TextView(this)
    brand.text = CallUi.tr("Gambot · שיחה נכנסת", "Gambot · Incoming call")
    brand.setTextColor(Color.parseColor("#9bd0bf"))
    brand.textSize = 15f
    brand.gravity = Gravity.CENTER
    column.addView(brand)

    val title = if (name.isNotBlank()) name else from
    val initial = title.trim().firstOrNull { it.isLetter() }?.uppercaseChar()?.toString() ?: "☎"
    val avatar = TextView(this)
    avatar.text = initial
    avatar.textSize = 44f
    avatar.setTextColor(Color.WHITE)
    avatar.gravity = Gravity.CENTER
    avatar.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#2e6155")) }
    val avatarLp = LinearLayout.LayoutParams(dp(112), dp(112))
    avatarLp.topMargin = dp(48)
    column.addView(avatar, avatarLp)

    val nameView = TextView(this)
    nameView.text = title.ifBlank { CallUi.tr("מספר חסוי", "Unknown number") }
    nameView.setTextColor(Color.WHITE)
    nameView.textSize = 30f
    nameView.setTypeface(null, Typeface.BOLD)
    nameView.gravity = Gravity.CENTER
    val nameLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    nameLp.topMargin = dp(28)
    column.addView(nameView, nameLp)

    if (name.isNotBlank() && from.isNotBlank()) {
      val number = TextView(this)
      number.text = from
      number.setTextColor(Color.parseColor("#cfe5dd"))
      number.textSize = 18f
      number.gravity = Gravity.CENTER
      number.textDirection = View.TEXT_DIRECTION_LTR
      val numLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      numLp.topMargin = dp(8)
      column.addView(number, numLp)
    }

    val spacer = View(this)
    column.addView(spacer, LinearLayout.LayoutParams(0, 0, 1f))

    val buttons = LinearLayout(this)
    buttons.orientation = LinearLayout.HORIZONTAL
    buttons.gravity = Gravity.CENTER
    buttons.weightSum = 2f
    // Decline and Answer keep their sides (left / right) in both text directions, like the phone's own call screen.
    buttons.layoutDirection = View.LAYOUT_DIRECTION_LTR
    val declineCol = circle(Color.parseColor("#e5484d"), CallUi.tr("דחה", "Decline"), "✕") { decline() }
    val answerCol = circle(Color.parseColor("#2fb457"), CallUi.tr("ענה", "Answer"), "✆") { answer() }
    buttons.addView(declineCol, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    buttons.addView(answerCol, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    column.addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    root.addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    return root
  }
}

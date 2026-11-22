package com.gambot.callui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** "Decline" on the call notification: the ring stops on this phone (the team keeps ringing). */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    CallUi.cancel(context, intent.getStringExtra(CallUi.EXTRA_CALL_ID))
  }
}

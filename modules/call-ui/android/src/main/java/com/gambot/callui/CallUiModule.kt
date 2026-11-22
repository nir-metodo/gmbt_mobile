package com.gambot.callui

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side of the native incoming-call screen (Android). */
class CallUiModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallUi")

    Function("isSupported") { true }

    /** The answer the user chose on the native call screen (null when none / too old). Read once. */
    Function("consumePendingAction") {
      val ctx = appContext.reactContext
      val result: Map<String, Any?>? = if (ctx == null) null else CallUi.consumePendingAnswer(ctx)
      result
    }

    Function("hasPendingAction") {
      val ctx = appContext.reactContext ?: return@Function false
      CallUi.peekPendingAnswer(ctx)
    }

    /** The call was answered / ended / declined from inside the app: drop the native notification + screen. */
    Function("cancelIncoming") { callId: String? ->
      val ctx = appContext.reactContext ?: return@Function false
      CallUi.cancel(ctx, callId)
      true
    }

    /** Android 14+: the user can turn "full screen notifications" off for the app - then a locked phone only shows a heads-up. */
    Function("canUseFullScreenIntent") {
      val ctx = appContext.reactContext ?: return@Function true
      if (Build.VERSION.SDK_INT >= 34) {
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
      } else true
    }

    Function("areNotificationsEnabled") {
      val ctx = appContext.reactContext ?: return@Function true
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
    }

    Function("openFullScreenIntentSettings") {
      val ctx = appContext.reactContext ?: return@Function false
      try {
        val intent = if (Build.VERSION.SDK_INT >= 34) {
          Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + ctx.packageName))
        } else {
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
      } catch (e: Exception) {
        false
      }
    }
  }
}

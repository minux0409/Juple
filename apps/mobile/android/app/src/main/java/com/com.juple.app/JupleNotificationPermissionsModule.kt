package com.juple.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/** Read the app-wide Settings switch as well as the Android 13 runtime grant. */
@ReactModule(name = JupleNotificationPermissionsModule.NAME)
class JupleNotificationPermissionsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = NAME
  @ReactMethod
  fun getStatus(promise: Promise) {
    val allowed = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
      reactApplicationContext, Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
    promise.resolve(if (allowed && NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled()) "granted" else "denied")
  }
  companion object { const val NAME = "JupleNotificationPermissions" }
}

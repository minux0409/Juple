package com.juple.app

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import androidx.core.view.WindowCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * Makes the system NAVIGATION bar (the 3-button / gesture area at the bottom) follow the app's resolved theme, live - no restart.
 *
 * With edge-to-edge (targetSdk 35+) the system draws that bar over the app: `navigationBarColor` is ignored there, and in 3-button mode
 * the platform adds a contrast scrim whose colour follows the window's light/dark navigation appearance and background. So this sets,
 * on the activity window: the icon appearance (light icons on a dark app, dark icons on a light one), the window background to the
 * app's surface colour (what shows behind the transparent bar), no forced contrast scrim, and - for older Android where it still
 * applies - the bar colour. Gesture navigation keeps its transparent handle area; nothing here changes the insets, so the layout is
 * untouched. The status bar is left to the existing handling.
 */
@ReactModule(name = JupleSystemBarsModule.NAME)
class JupleSystemBarsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  @ReactMethod
  fun setNavigationBarTheme(isDark: Boolean, color: String) {
    val activity = reactApplicationContext.currentActivity ?: return
    val parsed = try { Color.parseColor(color) } catch (_: IllegalArgumentException) { return }
    activity.runOnUiThread {
      val window = activity.window
      WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = !isDark
      window.setBackgroundDrawable(ColorDrawable(parsed))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isNavigationBarContrastEnforced = false
      }
      @Suppress("DEPRECATION")
      window.navigationBarColor = parsed
    }
  }

  companion object {
    const val NAME = "JupleSystemBars"
  }
}

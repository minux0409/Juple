package com.juple.app

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.view.Window
import androidx.core.view.WindowCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.interfaces.ExtraWindowEventListener
import com.facebook.react.module.annotations.ReactModule
import java.util.Collections
import java.util.WeakHashMap

/**
 * Makes the system NAVIGATION bar (the 3-button / gesture area at the bottom) follow the app's resolved theme, live - no restart.
 *
 * With edge-to-edge (targetSdk 35+) the system draws that bar over the app: `navigationBarColor` is ignored there, and in 3-button mode
 * the platform adds a contrast scrim whose colour follows the window's light/dark navigation appearance and background. So this sets,
 * on the activity window: the icon appearance (light icons on a dark app, dark icons on a light one), the window background to the
 * app's surface colour (what shows behind the transparent bar), no forced contrast scrim, and - for older Android where it still
 * applies - the bar colour. Gesture navigation keeps its transparent handle area; nothing here changes the insets, so the layout is
 * untouched. The status bar is left to the existing handling.
 *
 * A React Native Modal / bottom sheet / action sheet is NOT part of the activity window: it is a Dialog with a window of its own, and React
 * Native only copies the status-bar appearance onto it. Its navigation bar therefore fell back to the dialog theme's defaults (a light
 * scrim, light appearance) and turned white over a dark app while any popup was open. This module is an ExtraWindowEventListener: every
 * dialog window React Native registers gets the SAME resolved theme as the activity (once when it opens, and again when the theme changes
 * while it is open), so no popup picks colours of its own and a closed popup leaves the activity exactly as it was.
 */
@ReactModule(name = JupleSystemBarsModule.NAME)
class JupleSystemBarsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), ExtraWindowEventListener {
  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addExtraWindowEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeExtraWindowEventListener(this)
    synchronized(dialogWindows) { dialogWindows.clear() }
    super.invalidate()
  }

  @ReactMethod
  fun setNavigationBarTheme(isDark: Boolean, color: String) {
    val activity = reactApplicationContext.currentActivity ?: return
    val parsed = try { Color.parseColor(color) } catch (_: IllegalArgumentException) { return }
    activity.runOnUiThread {
      val window = activity.window
      applyNavigationBar(window, isDark, parsed)
      window.setBackgroundDrawable(ColorDrawable(parsed))
      // Popups that are open right now follow at once; popups opened later are handled by onExtraWindowCreate.
      resolved = Resolved(isDark, parsed)
      openDialogWindows().forEach { applyNavigationBar(it, isDark, parsed) }
    }
  }

  override fun onExtraWindowCreate(window: Window) {
    synchronized(dialogWindows) { dialogWindows.add(window) }
    val theme = resolved ?: return
    // The dialog window's background stays transparent (the popup draws its own scrim); only the bar is themed.
    window.decorView.post { applyNavigationBar(window, theme.isDark, theme.color) }
    applyNavigationBar(window, theme.isDark, theme.color)
  }

  override fun onExtraWindowDestroy(window: Window) {
    synchronized(dialogWindows) { dialogWindows.remove(window) }
  }

  // A snapshot of the popups that are really on screen; a window whose view is gone is dropped, so nothing stale is ever restyled.
  private fun openDialogWindows(): List<Window> =
    synchronized(dialogWindows) {
      dialogWindows.retainAll { it.decorView.isAttachedToWindow }
      dialogWindows.toList()
    }

  private fun applyNavigationBar(window: Window, isDark: Boolean, color: Int) {
    WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = !isDark
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
    }
    // From Android 15 (edge-to-edge is forced) the bar colour is ignored and the window shows through; before that it is honoured.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      @Suppress("DEPRECATION")
      window.navigationBarColor = color
    }
  }

  private data class Resolved(val isDark: Boolean, val color: Int)

  companion object {
    const val NAME = "JupleSystemBars"

    // The theme last pushed from JS, and the dialog windows React Native currently has open (UI thread only in practice).
    @Volatile private var resolved: Resolved? = null
    // Weakly held: a popup that closes without RN's destroy event (an Activity that dies first) can never be kept alive by this set.
    private val dialogWindows: MutableSet<Window> = Collections.newSetFromMap(WeakHashMap())
  }
}

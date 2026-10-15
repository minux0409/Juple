package com.juple.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages + IncomingSharePackage() + dogfoodNativeAuthPackage(),
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }

  // Exists only in src/dogfood; no Native Auth SDK or bridge is packaged into Play/release builds.
  private fun dogfoodNativeAuthPackage(): List<ReactPackage> = try {
    listOf(Class.forName("com.juple.app.NativeAuthSpikePackage").getDeclaredConstructor().newInstance() as ReactPackage)
  } catch (_: ClassNotFoundException) {
    emptyList()
  }
}

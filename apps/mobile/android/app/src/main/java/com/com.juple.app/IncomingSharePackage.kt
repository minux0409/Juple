package com.juple.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class IncomingSharePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      NativeIncomingShareModule.Name -> NativeIncomingShareModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    val moduleClass = NativeIncomingShareModule::class.java
    val annotation = requireNotNull(moduleClass.getAnnotation(ReactModule::class.java))
    val info = ReactModuleInfo(
      NativeIncomingShareModule.Name,
      moduleClass.name,
      false,
      annotation.needsEagerInit,
      annotation.isCxxModule,
      true,
    )
    return ReactModuleInfoProvider { mapOf(NativeIncomingShareModule.Name to info) }
  }
}
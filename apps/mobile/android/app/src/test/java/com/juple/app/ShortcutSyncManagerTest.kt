package com.juple.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Plain JVM tests for ShortcutSyncManager's id encoding - the only piece of this feature's native
 * code with no Context/Intent/SharedPreferences dependency, so it is the one part testable without
 * Robolectric or a real device (this project has no Robolectric harness set up; see
 * PendingShareQueueTest.kt's absence - Intent/SharedPreferences-dependent logic is verified via
 * real-device testing instead, not native unit tests, this round).
 */
class ShortcutSyncManagerTest {
  @Test
  fun `shortcutId then categoryIdFromShortcutId round-trips`() {
    val shortcutId = ShortcutSyncManager.shortcutId(42L)
    assertEquals(42L, ShortcutSyncManager.categoryIdFromShortcutId(shortcutId))
  }

  @Test
  fun `categoryIdFromShortcutId rejects an id this app never minted`() {
    assertNull(ShortcutSyncManager.categoryIdFromShortcutId("some-other-app-shortcut"))
  }

  @Test
  fun `categoryIdFromShortcutId rejects a non-numeric suffix`() {
    assertNull(ShortcutSyncManager.categoryIdFromShortcutId("category-not-a-number"))
  }

  @Test
  fun `categoryIdFromShortcutId rejects null`() {
    assertNull(ShortcutSyncManager.categoryIdFromShortcutId(null))
  }
}

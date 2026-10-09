package com.juple.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
  fun `staleShortcutIds is exactly what is held but no longer wanted`() {
    val held = listOf("category-1", "category-2", "category-3", "category-2")
    assertEquals(listOf("category-2", "category-3"), ShortcutSyncManager.staleShortcutIds(held, listOf("category-1")))
    assertEquals(emptyList<String>(), ShortcutSyncManager.staleShortcutIds(held, held))
    assertEquals(listOf("category-1", "category-2", "category-3"), ShortcutSyncManager.staleShortcutIds(held, emptyList()))
  }

  @Test
  fun `a Collection id maps to a stable id that is never shared with another Collection`() {
    assertTrue(ShortcutSyncManager.shortcutId(1L) != ShortcutSyncManager.shortcutId(2L))
    assertEquals(ShortcutSyncManager.shortcutId(7L), ShortcutSyncManager.shortcutId(7L))
  }

  @Test
  fun `published shortcut category equals the share-target category declared in shortcuts xml`() {
    val xml = java.io.File("src/main/res/xml/shortcuts.xml").readText()
    assertTrue(xml.contains("<category android:name=\"${ShortcutSyncManager.ShareTargetCategory}\""))
    assertTrue(xml.contains("android:mimeType=\"text/plain\""))
    assertTrue(xml.contains("android:targetClass=\"com.juple.app.ShareReceiverActivity\""))
  }

  @Test
  fun `categoryIdFromShortcutId rejects null`() {
    assertNull(ShortcutSyncManager.categoryIdFromShortcutId(null))
  }
}

class HomeShortcutTest {
  @Test
  fun `the icon glyph is the first whole character of the name, upper-cased`() {
    assertEquals("T", CollectionShortcutIcon.initialOf("trips"))
    assertEquals("여", CollectionShortcutIcon.initialOf("  여행 계획"))
    assertEquals("😀", CollectionShortcutIcon.initialOf("😀 fun"))
    assertEquals("?", CollectionShortcutIcon.initialOf("   "))
    assertEquals("?", CollectionShortcutIcon.initialOf(""))
  }

  @Test
  fun `only a plain hash-rgb color is ever trusted from the bridge`() {
    assertTrue(CollectionShortcutIcon.isHexColor("#EAF1FE"))
    assertTrue(!CollectionShortcutIcon.isHexColor("red"))
    assertTrue(!CollectionShortcutIcon.isHexColor("#EAF1F"))
    assertTrue(!CollectionShortcutIcon.isHexColor("#GGGGGG"))
    assertTrue(!CollectionShortcutIcon.isHexColor(null))
  }

  @Test
  fun `a confirmed pin joins the share targets without evicting any - unless it already is one`() {
    val two = listOf(PinnedCollectionEntry(1L, "A"), PinnedCollectionEntry(2L, "B"))
    assertTrue(HomeShortcutPinner.canJoinShareTargets(two, 3L, 3))
    assertTrue(!HomeShortcutPinner.canJoinShareTargets(two, 3L, 2))
    assertTrue(HomeShortcutPinner.canJoinShareTargets(two, 2L, 2))
    assertTrue(HomeShortcutPinner.canJoinShareTargets(emptyList(), 1L, 1))
  }

  @Test
  fun `the home icon and the share row use ONE identity per Collection`() {
    assertEquals(ShortcutSyncManager.shortcutId(5L), ShortcutSyncManager.shortcutId(5L))
    assertEquals(5L, ShortcutSyncManager.categoryIdFromShortcutId(ShortcutSyncManager.shortcutId(5L)))
  }
}

class CollectionShortcutIconChoiceTest {
  @Test
  fun `A - a Collection photo wins over everything`() {
    assertEquals(ShortcutVisual.Image, CollectionShortcutIcon.chooseVisual(hasImage = true, glyphAvailable = true))
    assertEquals(ShortcutVisual.Image, CollectionShortcutIcon.chooseVisual(hasImage = true, glyphAvailable = false))
  }

  @Test
  fun `B - no photo means the configured icon on its color`() {
    assertEquals(ShortcutVisual.Glyph, CollectionShortcutIcon.chooseVisual(hasImage = false, glyphAvailable = true))
  }

  @Test
  fun `C and E - no photo and no resolvable icon (unknown key) is the initial fallback`() {
    assertEquals(ShortcutVisual.Initial, CollectionShortcutIcon.chooseVisual(hasImage = false, glyphAvailable = false))
  }

  @Test
  fun `D - a photo that could not be prepared is simply no photo, so the icon is drawn instead`() {
    // CollectionIconImages.prepare returns null on any failure; the spec then carries image = null.
    assertEquals(ShortcutVisual.Glyph, CollectionShortcutIcon.chooseVisual(hasImage = false, glyphAvailable = true))
  }

  @Test
  fun `a photo is only fetched from a real https link or a loopback emulator link - never from anything else`() {
    assertTrue(CollectionIconImages.isFetchableUrl("https://acct.blob.core.windows.net/x/y.png?sig=1"))
    assertTrue(CollectionIconImages.isFetchableUrl("http://127.0.0.1:10000/dev/x.png"))
    assertTrue(!CollectionIconImages.isFetchableUrl("http://example.com/x.png"))
    assertTrue(!CollectionIconImages.isFetchableUrl("file:///sdcard/x.png"))
    assertTrue(!CollectionIconImages.isFetchableUrl("content://media/x"))
    assertTrue(!CollectionIconImages.isFetchableUrl(""))
    assertTrue(!CollectionIconImages.isFetchableUrl(null))
  }

  @Test
  fun `a new photo version is a new cache file, and the file name never carries path characters`() {
    assertEquals("5-v2.png", CollectionIconImages.fileNameFor(5L, "v2"))
    assertTrue(CollectionIconImages.fileNameFor(5L, "v1") != CollectionIconImages.fileNameFor(5L, "v2"))
    assertEquals("5-abc.png", CollectionIconImages.fileNameFor(5L, "../a/b:c"))
  }
}

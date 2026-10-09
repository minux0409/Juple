package com.juple.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * A Collection's own photo, prepared for its shortcut icon. The app hands over the SAME short-lived signed read URL its
 * Collection card is showing (Collection.iconImageUrl) - a pre-signed link, so no Juple credential is involved and none is
 * implemented here - and the version (iconImageVersion) that says when the photo changed. The photo is fetched once per
 * version with short timeouts and a size cap, center-cropped to a square, downsampled, and kept as a small PNG in the app's
 * private cache (never a shortcut Intent, never a log, and clearable by the OS), so the Home icon and the Direct Share row
 * reuse it without another download. The URL itself is used only for that fetch and is never stored.
 *
 * Every failure - no photo, a bad or expired link, no network, an undecodable file - simply means "no photo": the caller then
 * draws the Collection's configured icon, and the shortcut is still created.
 */
object CollectionIconImages {
  private const val DirName = "collection-icon-images"
  private const val ConnectTimeoutMs = 4_000
  private const val ReadTimeoutMs = 6_000
  private const val MaxBytes = 4 * 1024 * 1024

  /** Pure: only a real https link (or a loopback http link for the local Azurite emulator) may be fetched. */
  fun isFetchableUrl(url: String?): Boolean {
    if (url.isNullOrBlank()) {
      return false
    }
    return try {
      val parsed = java.net.URI(url.trim())
      val host = parsed.host ?: return false
      parsed.scheme == "https" || (parsed.scheme == "http" && (host == "127.0.0.1" || host == "localhost"))
    } catch (_: Exception) {
      false
    }
  }

  /** Pure: the cache file name of one Collection's photo at one version - a new version is a new file, so a stale photo is never reused. */
  fun fileNameFor(collectionId: Long, version: String): String =
    "$collectionId-${version.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(64)}.png"

  /** The prepared photo if this exact version is already cached - no network. */
  fun cached(context: Context, collectionId: Long, version: String?): Bitmap? {
    if (version.isNullOrBlank()) {
      return null
    }
    val file = File(dir(context), fileNameFor(collectionId, version))
    return if (file.isFile) BitmapFactory.decodeFile(file.path) else null
  }

  /** The photo for this version: from the cache, else fetched from [url] and cached. Null on any failure. Blocking - call off the UI thread. */
  fun prepare(context: Context, collectionId: Long, version: String?, url: String?): Bitmap? {
    cached(context, collectionId, version)?.let { return it }
    if (!isFetchableUrl(url)) {
      return null
    }
    return try {
      val square = squareFrom(download(url!!.trim())) ?: return null
      if (!version.isNullOrBlank()) {
        store(context, collectionId, version, square)
      }
      square
    } catch (_: Exception) {
      null
    }
  }

  /** Removes the cached photos (sign-out / account change). */
  fun clear(context: Context) {
    File(dir(context), "").listFiles()?.forEach { it.delete() }
  }

  private fun dir(context: Context): File = File(context.cacheDir, DirName).apply { mkdirs() }

  private fun store(context: Context, collectionId: Long, version: String, bitmap: Bitmap) {
    val directory = dir(context)
    // Older versions of this Collection's photo go first.
    directory.listFiles { file -> file.name.startsWith("$collectionId-") }?.forEach { it.delete() }
    File(directory, fileNameFor(collectionId, version)).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  private fun download(url: String): ByteArray {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = ConnectTimeoutMs
      readTimeout = ReadTimeoutMs
      instanceFollowRedirects = false
      requestMethod = "GET"
    }
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        throw IllegalStateException("not ok")
      }
      val output = ByteArrayOutputStream()
      connection.inputStream.use { input ->
        val buffer = ByteArray(16 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
          if (output.size() > MaxBytes) throw IllegalStateException("too large")
        }
      }
      return output.toByteArray()
    } finally {
      connection.disconnect()
    }
  }

  /** Decodes with downsampling, then center-crops to a square of at most [CollectionShortcutIcon.SizePx]. Never stretches. */
  private fun squareFrom(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      return null
    }
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= CollectionShortcutIcon.SizePx) {
      sample *= 2
    }
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val side = minOf(decoded.width, decoded.height)
    val target = minOf(side, CollectionShortcutIcon.SizePx)
    val square = Bitmap.createBitmap(target, target, Bitmap.Config.ARGB_8888)
    Canvas(square).drawBitmap(
      decoded,
      Rect((decoded.width - side) / 2, (decoded.height - side) / 2, (decoded.width + side) / 2, (decoded.height + side) / 2),
      Rect(0, 0, target, target),
      Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG),
    )
    return square
  }
}

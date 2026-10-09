package com.juple.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.graphics.PathParser
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject

/** Which picture a Collection's shortcut icon shows, best first. */
enum class ShortcutVisual { Image, Glyph, Initial }

/** Everything the icon of ONE Collection is drawn from - the same data its card in the app is drawn from. */
data class CollectionIconSpec(
  val name: String,
  /** The Collection's `icon` wire value (e.g. "Travel"); null/unknown falls through to the initial. */
  val iconKey: String?,
  val tileHex: String?,
  val glyphHex: String?,
  /** The Collection's own photo, already prepared by [CollectionIconImages]; null when it has none or it could not be prepared. */
  val image: Bitmap?,
)

/**
 * The icon of a Collection on the Android Home screen AND in the Sharesheet's Direct Share row - one builder, so the same
 * Collection is recognisable in both. Drawn locally, from what the Collection card itself shows, best first:
 * 1. its own photo (center-cropped to a square, never stretched);
 * 2. its configured icon in its configured color: the card's soft tile color as the background and the glyph - the very
 *    primitives the app's icon components draw, generated into assets/collection_icon_geometry.json and checked against
 *    them by a Jest test - in the card's glyph color;
 * 3. the initial of its name on the tile color (only when the photo and the glyph are both unavailable).
 * The bitmap is a clean full-bleed square with its content inside the adaptive-icon safe zone: the launcher applies its own
 * mask (nothing launcher-specific is baked in).
 */
object CollectionShortcutIcon {
  /** 108dp adaptive canvas at a high density; launchers scale it. */
  const val SizePx = 432
  private val HexColor = Regex("^#[0-9A-Fa-f]{6}$")
  // Lazy: Color.parseColor is an Android call, and this object must load in plain JVM unit tests (the selection logic is pure).
  private val FallbackTile by lazy { Color.parseColor("#EAF1FE") }
  private val FallbackGlyph by lazy { Color.parseColor("#5478B0") }

  /** Pure: the best picture available. A photo that failed to prepare is simply "no photo"; an icon not in the asset is "no glyph". */
  fun chooseVisual(hasImage: Boolean, glyphAvailable: Boolean): ShortcutVisual =
    when {
      hasImage -> ShortcutVisual.Image
      glyphAvailable -> ShortcutVisual.Glyph
      else -> ShortcutVisual.Initial
    }

  /** The first user-perceived character of the name, upper-cased; "?" for a blank name. Code-point aware (emoji, Hangul, supplementary planes). */
  fun initialOf(name: String): String {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) {
      return "?"
    }
    return String(Character.toChars(trimmed.codePointAt(0))).uppercase()
  }

  /** True for the "#RRGGBB" form the bridge may carry - the only one ever handed to Color.parseColor. */
  fun isHexColor(value: String?): Boolean = value != null && HexColor.matches(value)

  /** A "#RRGGBB" color, or [fallback] for anything else (the value comes over the bridge and is not trusted). */
  fun parseColor(hex: String?, fallback: Int): Int = if (isHexColor(hex)) Color.parseColor(hex) else fallback

  fun create(context: Context, spec: CollectionIconSpec): IconCompat {
    val bitmap = Bitmap.createBitmap(SizePx, SizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val glyph = spec.iconKey?.let { CollectionIconGeometry.primitivesFor(context, it) }
    when (chooseVisual(spec.image != null, glyph != null)) {
      ShortcutVisual.Image -> drawImage(canvas, spec.image!!)
      ShortcutVisual.Glyph -> {
        canvas.drawColor(parseColor(spec.tileHex, FallbackTile))
        CollectionIconGeometry.draw(canvas, glyph!!, parseColor(spec.glyphHex, FallbackGlyph), SizePx / 2f, SizePx / 2f, SizePx * GlyphShare)
      }
      ShortcutVisual.Initial -> {
        canvas.drawColor(parseColor(spec.tileHex, FallbackTile))
        drawInitial(canvas, spec.name, parseColor(spec.glyphHex, FallbackGlyph))
      }
    }
    return IconCompat.createWithAdaptiveBitmap(bitmap)
  }

  /** The glyph's box as a share of the canvas: inside the 66% adaptive safe zone with room to breathe. */
  private const val GlyphShare = 0.46f

  /** Center-crops to a square and fills the canvas; the launcher's mask decides the final shape. */
  private fun drawImage(canvas: Canvas, image: Bitmap) {
    val side = minOf(image.width, image.height)
    val source = android.graphics.Rect((image.width - side) / 2, (image.height - side) / 2, (image.width + side) / 2, (image.height + side) / 2)
    canvas.drawBitmap(image, source, android.graphics.Rect(0, 0, SizePx, SizePx), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
  }

  private fun drawInitial(canvas: Canvas, name: String, color: Int) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = color
      textAlign = Paint.Align.CENTER
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      textSize = SizePx * 0.40f
    }
    val centreY = SizePx / 2f - (paint.descent() + paint.ascent()) / 2f
    canvas.drawText(initialOf(name), SizePx / 2f, centreY, paint)
  }
}

/** One drawable piece of an icon glyph (24x24 space), as generated from the app's icon components. */
class GlyphPrimitive(val json: JSONObject)

/** Loads and draws the glyph geometry asset (assets/collection_icon_geometry.json). */
object CollectionIconGeometry {
  private const val AssetName = "collection_icon_geometry.json"
  private const val ViewBox = 24f
  private var cache: JSONObject? = null

  @Synchronized
  private fun load(context: Context): JSONObject? {
    cache?.let { return it }
    return try {
      context.assets.open(AssetName).use { JSONObject(it.readBytes().toString(Charsets.UTF_8)) }.also { cache = it }
    } catch (_: Exception) {
      null
    }
  }

  /** The primitives of an icon, or null for an icon this build does not know (the caller falls back). */
  fun primitivesFor(context: Context, iconKey: String): List<GlyphPrimitive>? {
    val array: JSONArray = load(context)?.optJSONArray(iconKey) ?: return null
    return (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::GlyphPrimitive) }.takeIf { it.isNotEmpty() }
  }

  /** Draws the glyph centered at (cx, cy), fitting a [boxPx] square. A primitive it cannot draw is skipped, never fatal. */
  fun draw(canvas: Canvas, primitives: List<GlyphPrimitive>, color: Int, cx: Float, cy: Float, boxPx: Float) {
    val scale = boxPx / ViewBox
    canvas.save()
    canvas.translate(cx - boxPx / 2f, cy - boxPx / 2f)
    canvas.scale(scale, scale)
    for (primitive in primitives) {
      try {
        drawOne(canvas, primitive.json, color)
      } catch (_: Exception) {
        // One malformed primitive must not cost the whole icon.
      }
    }
    canvas.restore()
  }

  private fun drawOne(canvas: Canvas, p: JSONObject, color: Int) {
    val stroke = p.optBoolean("stroke", false)
    val fill = p.optBoolean("fill", false)
    val paints = buildList {
      if (fill) add(Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.FILL })
      if (stroke) {
        add(
          Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = p.optDouble("sw", 1.0).toFloat()
            strokeCap = when (p.optString("cap")) { "round" -> Paint.Cap.ROUND; "square" -> Paint.Cap.SQUARE; else -> Paint.Cap.BUTT }
            strokeJoin = when (p.optString("join")) { "round" -> Paint.Join.ROUND; "bevel" -> Paint.Join.BEVEL; else -> Paint.Join.MITER }
          },
        )
      }
    }
    if (paints.isEmpty()) {
      return
    }
    fun f(key: String) = p.optDouble(key, 0.0).toFloat()
    when (p.optString("t")) {
      "path" -> PathParser.createPathFromPathData(p.getString("d"))?.let { path -> paints.forEach { canvas.drawPath(path, it) } }
      "circle" -> paints.forEach { canvas.drawCircle(f("cx"), f("cy"), f("r"), it) }
      "ellipse" -> paints.forEach { canvas.drawOval(RectF(f("cx") - f("rx"), f("cy") - f("ry"), f("cx") + f("rx"), f("cy") + f("ry")), it) }
      "rect" -> {
        val rect = RectF(f("x"), f("y"), f("x") + f("width"), f("y") + f("height"))
        paints.forEach { canvas.drawRoundRect(rect, f("rx"), if (p.has("ry")) f("ry") else f("rx"), it) }
      }
      "line" -> paints.forEach { canvas.drawLine(f("x1"), f("y1"), f("x2"), f("y2"), it) }
      "polygon", "polyline" -> {
        val values = p.getString("points").trim().split(Regex("[\\s,]+")).mapNotNull { it.toFloatOrNull() }
        if (values.size >= 4) {
          val path = Path().apply {
            moveTo(values[0], values[1])
            var i = 2
            while (i + 1 < values.size) { lineTo(values[i], values[i + 1]); i += 2 }
            if (p.optString("t") == "polygon") close()
          }
          paints.forEach { canvas.drawPath(path, it) }
        }
      }
    }
  }
}

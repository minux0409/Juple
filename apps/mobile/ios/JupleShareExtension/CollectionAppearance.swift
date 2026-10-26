import ImageIO
import UIKit

/// How a Collection's tile looks, read from the same fields the app draws it from (src/collections/collectionColors.ts,
/// collectionIcons.ts, CategoryIconTile): its photo, else its icon on its color, else the id-deterministic default color.
enum CollectionAppearance {
  struct Tile {
    let background: UIColor
    let glyph: UIColor
  }

  private static let named: [String: (Int, Int)] = [
    "Blue": (0xEAF1FE, 0x5478B0), "Mint": (0xEAF5EE, 0x5C9878), "Rose": (0xFBEDEE, 0xB97278), "Amber": (0xFBF3DE, 0xB0924E),
    "Purple": (0xF1EBF7, 0x8A72A8), "Peach": (0xFBEEE6, 0xBD8863), "Teal": (0xE6F5F3, 0x4E9690), "Slate": (0xEDF1F5, 0x6B7A8F),
    "Coral": (0xFDEDEA, 0xC86B5D), "Lime": (0xF0F7E7, 0x729B45), "Sky": (0xEAF6FC, 0x4D92B7), "Indigo": (0xECEEFA, 0x6574B7),
    "Lavender": (0xF5EFFA, 0x9473B1), "Sand": (0xF7F1E7, 0xA48257),
  ]
  /// collectionColors.ts DETERMINISTIC_PALETTE_COLOR_KEYS: a Collection without a color gets one of these by its id.
  private static let deterministic = ["Blue", "Rose", "Amber", "Mint", "Purple", "Peach"]

  static func tile(color: String?, collectionId: Int64) -> Tile {
    if let color, let pair = named[color] {
      return Tile(background: rgb(pair.0), glyph: rgb(pair.1))
    }
    if let color, let custom = customColor(color) {
      // resolveCollectionColorTile: a custom color's glyph is the same color darkened by 72 per channel.
      return Tile(background: rgb(custom), glyph: rgb(((max(0, (custom >> 16 & 0xFF) - 72)) << 16) | ((max(0, (custom >> 8 & 0xFF) - 72)) << 8) | max(0, (custom & 0xFF) - 72)))
    }
    let pair = named[deterministic[Int(abs(collectionId) % Int64(deterministic.count))]]!
    return Tile(background: rgb(pair.0), glyph: rgb(pair.1))
  }

  /// collectionIcons.ts COLLECTION_ICON_KEYS -> the closest SF Symbol; anything unknown is the folder (the app's default icon).
  static func symbol(for icon: String?) -> UIImage? {
    // Outline glyphs, like the app's line icons.
    let names: [String: String] = [
      "Folder": "folder", "Heart": "heart", "Plane": "airplane", "Gamepad": "gamecontroller", "Utensils": "fork.knife",
      "ShoppingBag": "bag", "Home": "house", "Laptop": "laptopcomputer", "Globe": "globe", "Tag": "tag",
      "Travel": "airplane.departure", "Fitness": "figure.walk", "Book": "book", "Music": "music.note", "Camera": "camera",
      "Movie": "film", "Briefcase": "briefcase", "Car": "car", "Gift": "gift", "Coffee": "cup.and.saucer",
      "Calendar": "calendar", "Pet": "pawprint", "Sports": "sportscourt", "Map": "map", "Study": "graduationcap",
    ]
    return UIImage(systemName: names[icon ?? ""] ?? "folder") ?? UIImage(systemName: "folder")
  }

  private static func customColor(_ value: String) -> Int? {
    guard value.count == 7, value.first == "#", let hex = Int(value.dropFirst(), radix: 16) else { return nil }
    return hex
  }

  static func rgb(_ hex: Int) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }
}

/// Pictures from the network (a link's preview image, a Collection's photo): https only, bounded in size, decoded straight to a small
/// thumbnail (a Share extension has little memory), kept only in memory for this one share. A failure simply leaves the placeholder.
final class ShareImageLoader {
  private let session: URLSession
  private let cache = NSCache<NSString, UIImage>()
  private static let maxBytes = 8_000_000

  init(session: URLSession) {
    self.session = session
    cache.countLimit = 80
  }

  /// Already decoded for this share: shown at once, with no task and no empty frame in between.
  func cachedImage(from address: String, pointSize: CGFloat) -> UIImage? {
    cache.object(forKey: Self.key(address, pointSize))
  }

  private static func key(_ address: String, _ pointSize: CGFloat) -> NSString { "\(Int(pointSize))|\(address)" as NSString }

  func image(from address: String?, pointSize: CGFloat) async -> UIImage? {
    guard let address, let url = URL(string: address), url.scheme?.lowercased() == "https", !(url.host ?? "").isEmpty else { return nil }
    let key = Self.key(address, pointSize)
    if let cached = cache.object(forKey: key) { return cached }
    guard let (data, response) = try? await session.data(from: url), data.count <= Self.maxBytes,
      ((response as? HTTPURLResponse)?.statusCode ?? 0) == 200,
      let source = CGImageSourceCreateWithData(data as CFData, nil)
    else { return nil }
    // 3x covers every iPhone/iPad screen; UIScreen is main-actor state this background decode must not touch.
    let pixels = pointSize * 3
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: pixels,
    ]
    guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let image = UIImage(cgImage: cgImage)
    cache.setObject(image, forKey: key)
    return image
  }
}

import UIKit

/// Juple's colors (src/theme/tokens.ts), light and dark.
enum SharePalette {
  /// BRAND_PRIMARY (#6751FC) in both themes, as the app.
  static let brand = dynamic(light: 0x6751FC, dark: 0x6751FC)
  static let brandSoft = dynamic(light: 0xEEEBFF, dark: 0x26224A)
  static let brandText = dynamic(light: 0x5A44EE, dark: 0xA99BFF)
  static let onBrand = dynamic(light: 0xFFFFFF, dark: 0xFFFFFF)
  static let background = dynamic(light: 0xF7F9FC, dark: 0x101318)
  static let surface = dynamic(light: 0xFFFFFF, dark: 0x181C23)
  static let surfaceMuted = dynamic(light: 0xF1F4F9, dark: 0x20252E)
  static let border = dynamic(light: 0xDDE4EF, dark: 0x313846)
  static let textPrimary = dynamic(light: 0x111111, dark: 0xF2F4F7)
  static let textSecondary = dynamic(light: 0x666666, dark: 0xA9B1BE)
  /// dangerText: an error line on a normal surface.
  static let danger = dynamic(light: 0xB42318, dark: 0xFF8A8A)

  private static func dynamic(light: Int, dark: Int) -> UIColor {
    UIColor { $0.userInterfaceStyle == .dark ? color(dark) : color(light) }
  }

  private static func color(_ hex: Int) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }
}

enum ShareStrings {
  static let reading = NSLocalizedString("share.reading", comment: "")
  static let connecting = NSLocalizedString("share.connecting", comment: "")
  static let saving = NSLocalizedString("share.saving", comment: "")
  static let noLink = NSLocalizedString("share.noLink", comment: "")
  static let failed = NSLocalizedString("share.failed", comment: "")
  static let signedOut = NSLocalizedString("share.signedOut", comment: "")
  static let sessionExpired = NSLocalizedString("share.sessionExpired", comment: "")
  static let offline = NSLocalizedString("share.offline", comment: "")
  static let collectionLinkNeedsApp = NSLocalizedString("share.collectionLinkNeedsApp", comment: "")
  static let subscriptionRequired = NSLocalizedString("share.subscriptionRequired", comment: "")
  static let invalidLink = NSLocalizedString("share.invalidLink", comment: "")
  static let collectionUnavailable = NSLocalizedString("share.collectionUnavailable", comment: "")
  static let collectionsFailed = NSLocalizedString("share.collectionsFailed", comment: "")
  static let titlePlaceholder = NSLocalizedString("share.titlePlaceholder", comment: "")
  static let collections = NSLocalizedString("share.collections", comment: "")
  static let noCollection = NSLocalizedString("share.noCollection", comment: "")
  static let lockedCollection = NSLocalizedString("share.lockedCollection", comment: "")
  static let memo = NSLocalizedString("share.memo", comment: "")
  static let memoPlaceholder = NSLocalizedString("share.memoPlaceholder", comment: "")
  static let save = NSLocalizedString("share.save", comment: "")
  static let cancel = NSLocalizedString("share.cancel", comment: "")
  static let closeForLater = NSLocalizedString("share.closeForLater", comment: "")
  static let retry = NSLocalizedString("share.retry", comment: "")
  static let done = NSLocalizedString("share.done", comment: "")
  static let close = NSLocalizedString("share.close", comment: "")
  static let password = NSLocalizedString("share.password", comment: "")
  static let unlock = NSLocalizedString("share.unlock", comment: "")
  static let lockPrompt = NSLocalizedString("share.lockPrompt", comment: "")
  static let sharePasswordPrompt = NSLocalizedString("share.sharePasswordPrompt", comment: "")
  static let lockWrongPassword = NSLocalizedString("share.lockWrongPassword", comment: "")
  static let sharePasswordWrong = NSLocalizedString("share.sharePasswordWrong", comment: "")
  static let tooManyAttempts = NSLocalizedString("share.tooManyAttempts", comment: "")
  static let unlockFailed = NSLocalizedString("share.unlockFailed", comment: "")
  static let newCollection = NSLocalizedString("share.newCollection", comment: "")
  static let addNewCollection = NSLocalizedString("share.addNewCollection", comment: "")
  static let collectionSearch = NSLocalizedString("share.collectionSearch", comment: "")
  static let searchEmpty = NSLocalizedString("share.searchEmpty", comment: "")
  static let viewMode = NSLocalizedString("share.viewMode", comment: "")
  static let viewList = NSLocalizedString("share.viewList", comment: "")
  static let viewGrid = NSLocalizedString("share.viewGrid", comment: "")
  static let collectionName = NSLocalizedString("share.collectionName", comment: "")
  static let create = NSLocalizedString("share.create", comment: "")
  static let createFailed = NSLocalizedString("share.createFailed", comment: "")
  static let nameTooLong = NSLocalizedString("share.nameTooLong", comment: "")
  static let preview = NSLocalizedString("share.preview", comment: "")
}


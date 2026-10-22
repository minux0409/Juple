import Foundation

/// Links shared into Juple from another app's share sheet, waiting for the app to open them (iOS counterpart of Android's
/// PendingShareQueue). Compiled into BOTH the app and the JupleShareExtension target: the extension only appends, the app reads
/// and acknowledges. They are separate processes, so the queue lives in the App Group container as one small JSON file, written
/// under NSFileCoordinator so neither side ever reads half of the other's write.
///
/// What is stored is only what was shared - the text (a URL, or text containing one) and the title the sharing app offered - never a
/// token, an account or anything else; the file is protected by the device passcode (complete-until-first-unlock, because the app may
/// read it right after a reboot once the user has unlocked). The app's own sign-in and save rules apply when it is opened.
///
/// The extension writes every share here FIRST and removes it only once the server confirmed the save (or the person dismissed it),
/// so a share is never lost: if the extension is killed, signed out or offline, the app opens it in 새 링크 검토 next time.
@objc(JuplePendingShareStore)
public final class PendingShareStore: NSObject {
  static let appGroupIdentifier = "group.com.juple.app"
  private static let fileName = "pending-shares.json"
  /// A share is a deliberate user action, so this is never reached in practice; it only bounds a file nobody drains.
  private static let maxEntries = 50
  /// Matches what one share-sheet text can reasonably be; longer text is cut, never stored as is.
  static let maxTextLength = 8_000
  static let maxTitleLength = 300

  private static var fileURL: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
      .appendingPathComponent(fileName, isDirectory: false)
  }

  /// Appends one share and returns its id (also the save's clientRequestId, so a retried save never makes a second link), or nil when
  /// the App Group is not available (misconfigured entitlement) or the write failed.
  @objc public static func capture(text: String, initialTitle: String?) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let url = fileURL else { return nil }
    let id = UUID().uuidString.lowercased()
    var entry: [String: Any] = [
      "id": id,
      "text": String(trimmed.prefix(maxTextLength)),
      "receivedAtEpochMs": (Date().timeIntervalSince1970 * 1000).rounded(),
    ]
    if let title = initialTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
      entry["initialTitle"] = String(title.prefix(maxTitleLength))
    }
    let written = update(url) { entries in
      entries.append(entry)
      if entries.count > maxEntries {
        entries.removeFirst(entries.count - maxEntries)
      }
    }
    return written ? id : nil
  }

  // MARK: - 빠른 저장 (Quick Save on share)

  private static let quickSaveKey = "juple.quickSaveOnShare"

  /// The app's "빠른 저장" switch, mirrored here by the app (settings/quickSaveOnSharePreference.ts) so the extension can read it. A
  /// plain on/off choice, not a secret. Never set (fresh install, an app version from before) = OFF: nothing is saved silently.
  @objc public static var quickSaveOnShare: Bool {
    UserDefaults(suiteName: appGroupIdentifier)?.bool(forKey: quickSaveKey) ?? false
  }

  @objc public static func setQuickSaveOnShare(_ enabled: Bool) {
    UserDefaults(suiteName: appGroupIdentifier)?.set(enabled, forKey: quickSaveKey)
  }

  /// The waiting shares, oldest first, as JSON (`[{ id, text, receivedAtEpochMs, initialTitle? }]`). "[]" when there are none.
  @objc public static func pendingSharesJSON() -> String {
    guard let url = fileURL else { return "[]" }
    var result = "[]"
    coordinate(url, writing: false) { readURL in
      if let data = try? Data(contentsOf: readURL), (try? JSONSerialization.jsonObject(with: data)) is [Any],
        let text = String(data: data, encoding: .utf8)
      {
        result = text
      }
    }
    return result
  }

  /// Removes one share (the app has taken it). Unknown ids are ignored.
  @objc public static func acknowledge(id: String) {
    guard let url = fileURL else { return }
    _ = update(url) { entries in
      entries.removeAll { ($0["id"] as? String) == id }
    }
  }

  // MARK: - File access

  private static func update(_ url: URL, _ change: (inout [[String: Any]]) -> Void) -> Bool {
    var ok = false
    coordinate(url, writing: true) { writeURL in
      var entries = (try? Data(contentsOf: writeURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
      change(&entries)
      guard let data = try? JSONSerialization.data(withJSONObject: entries) else { return }
      do {
        try data.write(to: writeURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        ok = true
      } catch {
        ok = false
      }
    }
    return ok
  }

  private static func coordinate(_ url: URL, writing: Bool, _ body: (URL) -> Void) {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var error: NSError?
    if writing {
      coordinator.coordinate(writingItemAt: url, options: [], error: &error, byAccessor: body)
    } else {
      coordinator.coordinate(readingItemAt: url, options: [], error: &error, byAccessor: body)
    }
  }
}

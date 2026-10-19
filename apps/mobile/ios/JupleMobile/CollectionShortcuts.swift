import AppIntents
import Foundation

/// Device-local state behind the iOS "컬렉션 열기" shortcut: which Collections the Shortcuts app may offer (only those the
/// person added from the app's Collection menu - never the whole account, and never a locked one) and the one launch a
/// shortcut run left for JS. Nothing here is trusted as access: the app re-reads a launched Collection with the CURRENT
/// account before opening it (see CollectionShortcutRouter). Cleared on sign-out.
@objc(JupleCollectionShortcutStore)
public final class CollectionShortcutStore: NSObject {
  @objc public static let shared = CollectionShortcutStore()
  /// Posted on the main thread when a run left a launch, so a running app can act on it at once.
  @objc public static let launchNotification = Notification.Name("JupleCollectionShortcutLaunch")

  struct Choice: Codable, Equatable {
    let id: Int
    let name: String
  }

  private static let maxChoices = 50
  private static let maxNameLength = 100
  private let pendingKey = "juple.collectionShortcut.pendingCollectionId"
  private let choicesKey = "juple.collectionShortcut.choices"
  private let defaults = UserDefaults.standard
  private let lock = NSLock()

  func setPendingLaunch(collectionId: Int) {
    guard collectionId > 0 else { return }
    lock.lock()
    defaults.set(collectionId, forKey: pendingKey)
    lock.unlock()
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: CollectionShortcutStore.launchNotification, object: nil)
    }
  }

  /// Takes (and forgets) the pending launch.
  @objc public func consumePendingLaunch() -> NSNumber? {
    lock.lock()
    defer { lock.unlock() }
    let value = defaults.object(forKey: pendingKey) as? Int
    defaults.removeObject(forKey: pendingKey)
    guard let id = value, id > 0 else { return nil }
    return NSNumber(value: id)
  }

  /// Replaces the offered Collections from `[{ "id": number, "name": string }]`. Returns false (and changes nothing) for
  /// anything malformed.
  @objc public func setChoices(json: String) -> Bool {
    guard let data = json.data(using: .utf8),
      let decoded = try? JSONDecoder().decode([Choice].self, from: data),
      decoded.count <= CollectionShortcutStore.maxChoices
    else {
      return false
    }
    let cleaned = decoded.compactMap { choice -> Choice? in
      let name = choice.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard choice.id > 0, !name.isEmpty else { return nil }
      return Choice(id: choice.id, name: String(name.prefix(CollectionShortcutStore.maxNameLength)))
    }
    guard cleaned.count == decoded.count, let encoded = try? JSONEncoder().encode(cleaned) else {
      return false
    }
    lock.lock()
    defaults.set(encoded, forKey: choicesKey)
    lock.unlock()
    return true
  }

  func choices() -> [Choice] {
    lock.lock()
    defer { lock.unlock() }
    guard let data = defaults.data(forKey: choicesKey) else { return [] }
    return (try? JSONDecoder().decode([Choice].self, from: data)) ?? []
  }

  @objc public func choicesJson() -> String {
    guard let data = try? JSONEncoder().encode(choices()), let json = String(data: data, encoding: .utf8) else { return "[]" }
    return json
  }

  @objc public func clear() {
    lock.lock()
    defaults.removeObject(forKey: choicesKey)
    defaults.removeObject(forKey: pendingKey)
    lock.unlock()
  }
}

/// A Collection as the Shortcuts app shows it: its id and name only.
@available(iOS 16.0, *)
struct CollectionShortcutEntity: AppEntity {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("collectionShortcut.entityName", defaultValue: "Collection", table: "AppIntents")
  )
  static var defaultQuery = CollectionShortcutQuery()

  let id: Int
  let name: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }
}

@available(iOS 16.0, *)
struct CollectionShortcutQuery: EntityStringQuery {
  /// A shortcut keeps the id it was made with. A Collection that is no longer offered (removed, signed out, another
  /// account) still resolves, so the run opens Juple, which then explains that the Collection cannot be opened - the same
  /// as a stale Android Home icon - instead of the shortcut silently failing.
  func entities(for identifiers: [Int]) async throws -> [CollectionShortcutEntity] {
    let known = Dictionary(uniqueKeysWithValues: CollectionShortcutStore.shared.choices().map { ($0.id, $0.name) })
    let fallbackName = String(localized: LocalizedStringResource("collectionShortcut.entityName", defaultValue: "Collection", table: "AppIntents"))
    return identifiers.filter { $0 > 0 }.map { CollectionShortcutEntity(id: $0, name: known[$0] ?? fallbackName) }
  }

  func suggestedEntities() async throws -> [CollectionShortcutEntity] {
    CollectionShortcutStore.shared.choices().map { CollectionShortcutEntity(id: $0.id, name: $0.name) }
  }

  func entities(matching string: String) async throws -> [CollectionShortcutEntity] {
    let needle = string.trimmingCharacters(in: .whitespacesAndNewlines)
    return CollectionShortcutStore.shared.choices()
      .filter { needle.isEmpty || $0.name.localizedCaseInsensitiveContains(needle) }
      .map { CollectionShortcutEntity(id: $0.id, name: $0.name) }
  }
}

/// "컬렉션 열기": opens Juple at one Collection. Added to the Home screen by the person, from the Shortcuts app.
@available(iOS 16.0, *)
struct OpenCollectionIntent: AppIntent {
  static var title = LocalizedStringResource("collectionShortcut.openTitle", defaultValue: "Open Collection", table: "AppIntents")
  static var description = IntentDescription(
    LocalizedStringResource("collectionShortcut.openDescription", defaultValue: "Opens a collection in Juple.", table: "AppIntents")
  )
  static var openAppWhenRun = true

  @Parameter(title: LocalizedStringResource("collectionShortcut.entityName", defaultValue: "Collection", table: "AppIntents"))
  var collection: CollectionShortcutEntity

  func perform() async throws -> some IntentResult {
    CollectionShortcutStore.shared.setPendingLaunch(collectionId: collection.id)
    return .result()
  }
}

@available(iOS 16.0, *)
struct JupleAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OpenCollectionIntent(), phrases: ["Open a collection in \(.applicationName)"])
  }
}

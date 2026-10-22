import Foundation

/// A refusal from the Juple API, kept to what the share UI needs: the HTTP status and the ProblemDetails `code`.
struct ShareAPIError: Error {
  let status: Int
  let code: String?
}

struct ShareCollection: Decodable, Equatable {
  let id: Int64
  let name: String
  let accessRole: String?
  let isLocked: Bool?
  let isSharePasswordProtected: Bool?
  let color: String?
  let icon: String?
  let iconImageUrl: String?
  let iconImageVersion: String?
  let hasCollaborators: Bool?
  let isPublicShareActive: Bool?

  /// src/collections/collectionAccess.ts canAddItemsTo: a view-only share never takes a link.
  var canAddLinks: Bool { accessRole != "viewer" }
  var isSharedWithMe: Bool { accessRole != nil && accessRole != "owner" }
  /// collectionAccess.ts isCollaborative: the "shared" badge.
  var isCollaborative: Bool { isSharedWithMe || hasCollaborators == true || isPublicShareActive == true }
  /// The photo is drawn only with its version, as CategoryIconTile does.
  var photoUrl: String? { iconImageVersion == nil ? nil : iconImageUrl }

  enum Gate { case lock, sharePassword }

  /// src/collections/collectionAccess.ts contentGateOf: which password stands before this Collection for the caller, or none.
  var gate: Gate? {
    if isSharedWithMe && isSharePasswordProtected == true { return .sharePassword }
    return isLocked == true ? .lock : nil
  }
}

struct ShareUnlockGrant: Decodable {
  let unlockToken: String
  let expiresAtUtc: String
}

/// The few Juple API calls a share needs - the same requests the app's 새 링크 검토 makes (src/inbox/api/inboxApi.ts,
/// items/api/itemsApi.ts, urlMetadata/api/urlMetadataApi.ts, collections/api/collectionsApi.ts and sharePasswordApi.ts), with the
/// same client identity headers (src/api/clientIdentityHeaders.ts). Nothing here is logged.
final class JupleShareAPI {
  private let baseURL: URL
  private let accessToken: String
  private let urlSession: URLSession

  init(baseURL: URL, accessToken: String, urlSession: URLSession) {
    self.baseURL = baseURL
    self.accessToken = accessToken
    self.urlSession = urlSession
  }

  struct SavedEntry: Decodable {
    let id: Int64
  }

  /// POST /api/v1/inbox - idempotent by clientRequestId: a retry (or a second tap) returns the same link instead of a second one. An
  /// empty collectionIds is an explicit "no Collection"; unlockTokens holds the grant of each locked destination.
  func saveLink(url: String, clientRequestId: String, collectionIds: [Int64], unlockTokens: [Int64: String]) async throws -> SavedEntry {
    var body: [String: Any] = ["url": url, "clientRequestId": clientRequestId, "collectionIds": collectionIds]
    body["unlockTokens"] = Dictionary(uniqueKeysWithValues: unlockTokens.map { (String($0.key), $0.value) })
    guard let saved: SavedEntry = try await send("POST", "/api/v1/inbox", body: body) else { throw ShareAPIError(status: 0, code: nil) }
    return saved
  }

  func updateDetails(itemId: Int64, title: String, memo: String) async throws {
    let _: Empty? = try await send("PUT", "/api/v1/items/\(itemId)/details", body: ["title": title, "memo": memo])
  }

  func setPreviewImage(itemId: Int64, previewImageUrl: String) async throws {
    let _: Empty? = try await send("PUT", "/api/v1/items/\(itemId)/preview-image", body: ["previewImageUrl": previewImageUrl])
  }

  struct Metadata: Decodable {
    let title: String?
    let previewImageUrl: String?
  }

  func resolveMetadata(url: String) async throws -> Metadata? {
    try await send("POST", "/api/v1/url-metadata/resolve", body: ["url": url], timeout: 12)
  }

  /// The Collections a link may go into: the caller's own, then those shared with them (not view-only) - the picker's own list
  /// (src/collections/useCategoryPickerModal.ts). Bounded: a share sheet is not the place for thousands of rows.
  func destinations(maxPages: Int = 6) async throws -> [ShareCollection] {
    var result: [ShareCollection] = []
    var seen = Set<Int64>()
    for scope in [nil, "shared"] as [String?] {
      var cursor: String?
      var pages = 0
      repeat {
        var query = [URLQueryItem(name: "limit", value: "50")]
        if let scope { query.append(URLQueryItem(name: "scope", value: scope)) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        guard let page: CollectionsPage = try await send("GET", "/api/v1/collections", query: query) else { break }
        for collection in page.items where collection.canAddLinks && seen.insert(collection.id).inserted {
          result.append(collection)
        }
        cursor = page.nextCursor
        pages += 1
      } while cursor != nil && pages < maxPages
    }
    return result
  }

  /// POST /api/v1/collections - the app's 새 컬렉션 with its defaults (icon Folder, color Blue: DEFAULT_COLLECTION_ICON / _COLOR).
  func createCollection(name: String) async throws -> ShareCollection {
    let body: [String: Any] = ["name": name, "icon": "Folder", "color": "Blue"]
    guard let created: ShareCollection = try await send("POST", "/api/v1/collections", body: body) else { throw ShareAPIError(status: 0, code: nil) }
    return created
  }

  /// The Owner's lock (/unlock) or a member's share password (/share-password/unlock): a short-lived grant, the password is sent once.
  func unlock(collectionId: Int64, gate: ShareCollection.Gate, password: String) async throws -> ShareUnlockGrant {
    let path = gate == .lock ? "/api/v1/collections/\(collectionId)/unlock" : "/api/v1/collections/\(collectionId)/share-password/unlock"
    guard let grant: ShareUnlockGrant = try await send("POST", path, body: ["password": password]) else { throw ShareAPIError(status: 0, code: nil) }
    return grant
  }

  // MARK: - Transport

  private struct CollectionsPage: Decodable {
    let items: [ShareCollection]
    let nextCursor: String?
  }

  private struct Empty: Decodable {}

  private func send<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil, timeout: TimeInterval = 20) async throws -> T? {
    guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
      throw ShareAPIError(status: 0, code: nil)
    }
    if !query.isEmpty { components.queryItems = query }
    guard let url = components.url else { throw ShareAPIError(status: 0, code: nil) }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("ios", forHTTPHeaderField: "X-Juple-Platform")
    if let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String, !build.isEmpty {
      request.setValue(build, forHTTPHeaderField: "X-Juple-App-Build")
    }
    request.setValue(Locale.preferredLanguages.first ?? "en", forHTTPHeaderField: "Accept-Language")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await urlSession.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let problem = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      throw ShareAPIError(status: status, code: problem?["code"] as? String)
    }
    guard !data.isEmpty, T.self != Empty.self else { return nil }
    return try JSONDecoder().decode(T.self, from: data)
  }
}

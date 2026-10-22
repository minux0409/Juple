import Foundation
import Security

/// The signed-in Juple session as the app shares it with this extension (src/share/shareExtensionSession.ts): one Keychain item in
/// the App Group's access group, written by the app on sign-in / token renewal / start and deleted on every sign-out. It holds the
/// refresh token and the public, non-secret settings needed to use it (Entra token endpoint and client id, API base, web host).
/// Nothing is written back here: a renewed token stays in memory for this one share only.
struct ShareSession: Decodable {
  let version: Int
  let refreshToken: String
  let tokenEndpoint: String
  let clientId: String
  let scopes: [String]
  let apiBaseUrl: String
  let publicWebHost: String?

  static let keychainService = "com.juple.app.share-extension.session"

  /// Nil when signed out (no item), the item is unreadable, or it is not a usable https configuration.
  static func load() -> ShareSession? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccessGroup as String: PendingShareStore.appGroupIdentifier,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
      let session = try? JSONDecoder().decode(ShareSession.self, from: data), session.version == 1, !session.refreshToken.isEmpty,
      URL(string: session.tokenEndpoint)?.scheme == "https", let api = URL(string: session.apiBaseUrl), api.scheme == "https" || api.host == "localhost"
    else { return nil }
    return session
  }
}

enum ShareAuthError: Error {
  /// The session no longer works (revoked, expired): the person has to sign in to Juple again.
  case sessionExpired
  case unavailable
}

/// A short-lived access token for this share: the OAuth refresh grant against the same Entra tenant and public client the app uses
/// (react-native-app-auth's refresh). The token never leaves memory and is never logged.
enum ShareAccessToken {
  static func fetch(for session: ShareSession, urlSession: URLSession) async throws -> String {
    guard let endpoint = URL(string: session.tokenEndpoint) else { throw ShareAuthError.unavailable }
    var request = URLRequest(url: endpoint, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    var form = URLComponents()
    form.queryItems = [
      URLQueryItem(name: "grant_type", value: "refresh_token"),
      URLQueryItem(name: "client_id", value: session.clientId),
      URLQueryItem(name: "refresh_token", value: session.refreshToken),
      URLQueryItem(name: "scope", value: session.scopes.joined(separator: " ")),
    ]
    // URLComponents leaves "+" alone; in a form body it would read as a space.
    request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)

    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await urlSession.data(for: request)
    } catch {
      throw ShareAuthError.unavailable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    if (200..<300).contains(status), let token = body?["access_token"] as? String, !token.isEmpty {
      return token
    }
    // invalid_grant and friends: the refresh token itself is no longer accepted.
    if (400..<500).contains(status) {
      throw ShareAuthError.sessionExpired
    }
    throw ShareAuthError.unavailable
  }
}

import Foundation

/// What a share contains, judged the way the app judges it (src/share/sharedTextParser.ts + resolveIncomingShare.ts): only http(s)
/// links with a host count; anything else (file:, data:, javascript:, an app's own scheme) is never a link.
enum ShareLink {
  static func isWebLink(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
    return !(url.host ?? "").isEmpty
  }

  /// Every distinct web link in the text, in order.
  static func webLinks(in text: String) -> [URL] {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return [] }
    var seen = Set<String>()
    var links: [URL] = []
    for match in detector.matches(in: text, options: [], range: NSRange(text.startIndex..., in: text)) {
      guard let url = match.url, isWebLink(url), seen.insert(url.absoluteString).inserted else { continue }
      links.append(url)
    }
    return links
  }

  /// The one link of a share that holds exactly one (bare, or with a caption around it) - Android's Quick Save condition
  /// (incomingShareHeadlessTask: kind 'exactUrl'). Two different links, or none, need the person to decide.
  static func exactLink(in text: String) -> URL? {
    let links = webLinks(in: text)
    return links.count == 1 ? links[0] : nil
  }

  /// A Juple Collection share link (https://<public web host>/c/{publicId}) is opened as a Collection, never saved as a link
  /// (src/share/collectionShareUrl.ts) - that needs the app.
  static func isJupleCollectionLink(_ url: URL, publicWebHost: String?) -> Bool {
    guard let publicWebHost, !publicWebHost.isEmpty, url.host?.lowercased() == publicWebHost.lowercased() else { return false }
    let parts = url.path.split(separator: "/")
    return parts.count == 2 && parts[0] == "c" && !parts[1].isEmpty
  }
}

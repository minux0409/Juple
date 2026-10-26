import UIKit
import UniformTypeIdentifiers

/// The "Juple" entry in iOS's share sheet. It saves the shared link to the signed-in Juple account without opening the app:
///
///  - 빠른 저장 ON (the app's switch) and the share holds exactly one web link: saved at once - the same request the app's background
///    save makes on Android (POST /api/v1/inbox, idempotent by clientRequestId, then the sharing app's title) - and the sheet closes by
///    itself only after the server confirmed it. A failure keeps the sheet open with 다시 시도.
///  - 빠른 저장 OFF (or the share needs a decision): a small 새 링크 검토 inside the sheet - title, preview, Collections (a locked one
///    after its password, its grant sent with the save), memo - then 저장.
///
/// Every share is first written to the App Group queue (PendingShareStore) and removed only once the server confirmed the save or the
/// person dismissed it, so nothing is lost: signed out, an expired session, no network or the extension being killed all leave it for
/// the app's own 새 링크 검토. The session comes from the app (ShareSession); no password, token or shared text is ever logged.
final class ShareViewController: UIViewController {
  private enum Phase {
    case reading
    case saving
    case review
    case message
  }

  private var phase: Phase = .reading
  private var pendingId: String?
  private var link: URL?
  private var offeredTitle: String?
  /// The sharing app's own title field (attributedTitle - Android's EXTRA_SUBJECT/EXTRA_TITLE), not text around the link.
  private var structuredTitle: String?
  private var session: ShareSession?
  private var api: JupleShareAPI?
  private var collections: [ShareCollection] = []
  /// Collections made in this sheet: they stay first even when a later page of the list arrives after them.
  private var createdHere: [ShareCollection] = []
  private var selected: [Int64] = []
  private var grants: [Int64: (token: String, expiresAt: Date)] = [:]
  private var previewImageUrl: String?
  private var saveTask: Task<Void, Never>?
  private var saveFailed = false
  private var finished = false

  private lazy var urlSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 20
    configuration.timeoutIntervalForResource = 40
    return URLSession(configuration: configuration)
  }()

  // MARK: - Lifecycle

  override func viewDidLoad() {
    super.viewDidLoad()
    buildLayout()
    showMessage(ShareStrings.reading, buttons: [], spinner: true)
    Task { await start() }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    saveTask?.cancel()
  }

  private func start() async {
    let received = await receiveShare()
    guard let received else {
      showMessage(ShareStrings.noLink, buttons: [(ShareStrings.close, #selector(dismissWithoutQueue))])
      return
    }
    guard let id = PendingShareStore.capture(text: received.text, initialTitle: received.title) else {
      showMessage(ShareStrings.failed, buttons: [(ShareStrings.close, #selector(dismissWithoutQueue))])
      return
    }
    pendingId = id
    offeredTitle = received.title
    structuredTitle = received.structuredTitle
    link = ShareLink.exactLink(in: received.text) ?? ShareLink.webLinks(in: received.text).first

    guard let session = ShareSession.load(), let base = URL(string: session.apiBaseUrl), let link else {
      showMessage(ShareStrings.signedOut, buttons: [(ShareStrings.done, #selector(closeKeepingQueue))])
      return
    }
    self.session = session
    // A Juple Collection link opens that Collection - only the app can do that.
    if ShareLink.isJupleCollectionLink(link, publicWebHost: session.publicWebHost) {
      showMessage(ShareStrings.collectionLinkNeedsApp, buttons: [(ShareStrings.done, #selector(closeKeepingQueue))])
      return
    }

    showMessage(ShareStrings.connecting, buttons: [], spinner: true)
    do {
      let token = try await ShareAccessToken.fetch(for: session, urlSession: urlSession)
      api = JupleShareAPI(baseURL: base, accessToken: token, urlSession: urlSession)
    } catch ShareAuthError.sessionExpired {
      showMessage(ShareStrings.sessionExpired, buttons: [(ShareStrings.done, #selector(closeKeepingQueue))])
      return
    } catch {
      showMessage(ShareStrings.offline, buttons: [(ShareStrings.retry, #selector(retryStart)), (ShareStrings.close, #selector(closeKeepingQueue))])
      return
    }

    // 빠른 저장 only for exactly one link, as on Android; anything else is the person's decision.
    if PendingShareStore.quickSaveOnShare, ShareLink.exactLink(in: received.text) != nil {
      quickSave()
    } else {
      await showReview()
    }
  }

  @objc private func retryStart() {
    // The share is already queued; read the session and try again from there.
    guard let pendingId else { return }
    PendingShareStore.acknowledge(id: pendingId)
    self.pendingId = nil
    showMessage(ShareStrings.reading, buttons: [], spinner: true)
    Task { await start() }
  }

  // MARK: - Shared content

  private struct Received {
    let text: String
    /// Any title the share offered - prefills the review's title field.
    let title: String?
    /// Only the share's own title field: the one 빠른 저장 may write without anyone reviewing it.
    let structuredTitle: String?
  }

  /// The first web URL among the attachments, else the first text that contains one. Files, images and text without a link: nil.
  private func receiveShare() async -> Received? {
    let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    let title = items.lazy.compactMap { Self.title(of: $0) }.first
    let structuredTitle = items.lazy.compactMap { Self.cleanTitle($0.attributedTitle?.string) }.first

    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      if let url: URL = await load(provider, UTType.url), ShareLink.isWebLink(url) {
        return Received(text: String(url.absoluteString.prefix(PendingShareStore.maxTextLength)), title: title, structuredTitle: structuredTitle)
      }
    }
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      if let text: String = await load(provider, UTType.plainText), !ShareLink.webLinks(in: text).isEmpty {
        return Received(text: String(text.prefix(PendingShareStore.maxTextLength)), title: title, structuredTitle: structuredTitle)
      }
    }
    return nil
  }

  private func load<T>(_ provider: NSItemProvider, _ type: UTType) async -> T? {
    await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { item, _ in
        var value: Any? = item
        if T.self == URL.self {
          if let data = item as? Data { value = URL(dataRepresentation: data, relativeTo: nil) }
          if let string = item as? String { value = URL(string: string) }
        } else if T.self == String.self, let data = item as? Data {
          value = String(data: data, encoding: .utf8)
        }
        continuation.resume(returning: value as? T)
      }
    }
  }

  /// The page title the sharing app offered, when it is a short single line (the server's metadata may still give a better one).
  private static func title(of item: NSExtensionItem) -> String? {
    cleanTitle(item.attributedTitle?.string) ?? cleanTitle(item.attributedContentText?.string)
  }

  private static func cleanTitle(_ raw: String?) -> String? {
    let candidate = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let candidate, !candidate.isEmpty, !candidate.contains("\n"), candidate.count <= PendingShareStore.maxTitleLength,
      ShareLink.webLinks(in: candidate).isEmpty
    else { return nil }
    return candidate
  }

  // MARK: - 빠른 저장

  private func quickSave() {
    guard let api, let link, let pendingId, saveTask == nil else { return }
    phase = .saving
    showMessage(ShareStrings.saving, buttons: [], spinner: true)
    saveTask = Task {
      do {
        let saved = try await api.saveLink(url: link.absoluteString, clientRequestId: pendingId, collectionIds: [], unlockTokens: [:])
        // The server saves only the URL: the title and preview image are applied by the client, exactly as Android's Quick Save
        // does it (incomingShareHeadlessTask + urlMetadata/enrichItemTitle.ts). Best effort - the link is already saved.
        await enrichSavedLink(api: api, itemId: saved.id, url: link.absoluteString)
        await MainActor.run { self.finishSaved() }
      } catch {
        await MainActor.run {
          self.saveTask = nil
          self.saveFailed = true
          self.showMessage(Self.saveErrorText(error), buttons: [(ShareStrings.retry, #selector(self.retryQuickSave)), (ShareStrings.close, #selector(self.closeKeepingQueue))])
        }
      }
    }
  }

  /// enrichItemTitleFromUrlMetadata / enrichItemPreviewImageFromUrlMetadata: the sharing app's own title (if it gave one) is kept and
  /// only the picture comes from the server's metadata; without one, the server's title and picture are both applied. Text around the
  /// link is never written as a title here, because nobody reviewed it. Nothing here fails the save.
  private func enrichSavedLink(api: JupleShareAPI, itemId: Int64, url: String) async {
    if let structuredTitle {
      try? await api.updateDetails(itemId: itemId, title: structuredTitle, memo: "")
    }
    guard let metadata = try? await api.resolveMetadata(url: url) else { return }
    if structuredTitle == nil, let title = metadata.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
      try? await api.updateDetails(itemId: itemId, title: title, memo: "")
    }
    if let image = metadata.previewImageUrl, !image.isEmpty {
      try? await api.setPreviewImage(itemId: itemId, previewImageUrl: image)
    }
  }

  @objc private func retryQuickSave() {
    quickSave()
  }

  // MARK: - 새 링크 검토 in the sheet

  private let scrollView = UIScrollView()
  private let content = UIStackView()
  private let footer = UIStackView()
  private let thumbnail = UIImageView()
  private let thumbnailPlaceholder = UIImageView(image: UIImage(systemName: "link"))
  private let titleField = UITextField()
  private let domainLabel = UILabel()
  private let linkLabel = UILabel()
  private lazy var images = ShareImageLoader(session: urlSession)
  private lazy var picker = CollectionPickerView(images: images)
  private let memoView = UITextView()
  private let errorLabel = UILabel()
  private let memoPlaceholder = UILabel()
  /// The memo starts as one line (the app's minHeight 48) and grows with what is typed up to maxHeight 120, then scrolls inside.
  private lazy var memoHeight = memoView.heightAnchor.constraint(equalToConstant: 48)
  private let saveButton = UIButton(type: .system)
  private let closeButton = UIButton(type: .system)
  private let footerBackground = UIView()
  private var titleEditedByPerson = false
  private var isCreating = false

  private func showReview() async {
    guard let api, let link else { return }
    await MainActor.run {
      phase = .review
      titleField.text = offeredTitle
      domainLabel.text = Self.displayHost(of: link)
      linkLabel.text = link.absoluteString
      picker.setLoading()
      picker.setSelected(selected)
      messageCard.isHidden = true
      scrollView.isHidden = false
      footer.isHidden = false
      footerBackground.isHidden = false
      closeButton.isHidden = false
    }
    // Neither blocks 저장, nor each other: the Collections appear page by page as soon as they arrive, independently of the page's
    // title / preview (which can take up to its 12 s timeout); the link is saved as shared even when either failed.
    Task {
      let resolved = try? await api.resolveMetadata(url: link.absoluteString)
      await MainActor.run {
        guard let resolved else { return }
        applyResolvedTitle(resolved.title)
        previewImageUrl = resolved.previewImageUrl
        loadThumbnail(resolved.previewImageUrl)
      }
    }
    do {
      try await api.destinations { [weak self] partial in
        guard let self else { return }
        let created = Set(self.createdHere.map(\.id))
        self.collections = self.createdHere + partial.filter { !created.contains($0.id) }
        self.picker.setCollections(self.collections, failed: false)
        self.picker.setSelected(self.selected)
      }
    } catch {
      await MainActor.run {
        picker.setCollections(collections, failed: true)
        picker.setSelected(selected)
      }
    }
  }

  /// NewLinkReviewScreen's precedence: the person's own edit > the server's title > the sharing app's title; YouTube's generic
  /// "YouTube" page title is no title at all (isKnownYouTubePlaceholderTitle).
  private func applyResolvedTitle(_ title: String?) {
    guard !titleEditedByPerson, let title = title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { return }
    let host = link?.host?.lowercased() ?? ""
    let isYouTube = host.hasSuffix("youtube.com") || host == "youtu.be"
    if isYouTube && title.caseInsensitiveCompare("YouTube") == .orderedSame { return }
    titleField.text = title
  }

  @objc private func titleEdited() {
    titleEditedByPerson = true
  }

  private static func displayHost(of url: URL) -> String {
    var host = url.host ?? url.absoluteString
    if host.lowercased().hasPrefix("www.") { host.removeFirst(4) }
    return host
  }

  private func loadThumbnail(_ address: String?) {
    Task {
      guard let image = await images.image(from: address, pointSize: 72) else { return }
      await MainActor.run {
        self.thumbnail.image = image
        self.thumbnail.isHidden = false
        self.thumbnailPlaceholder.isHidden = true
      }
    }
  }

  // MARK: Collections

  private func wirePicker() {
    picker.onNone = { [weak self] in
      guard let self, self.phase == .review, self.saveTask == nil else { return }
      self.selected = []
      self.picker.setSelected(self.selected)
    }
    picker.onToggle = { [weak self] collection in self?.toggle(collection) }
    picker.onCreate = { [weak self] in self?.askNewCollection() }
  }

  private func toggle(_ collection: ShareCollection) {
    guard phase == .review, saveTask == nil else { return }
    if let index = selected.firstIndex(of: collection.id) {
      // Taking a locked Collection out again needs nothing: no link has been written yet.
      selected.remove(at: index)
      picker.setSelected(selected)
      return
    }
    if let gate = collection.gate, !hasLiveGrant(collection.id) {
      askPassword(for: collection, gate: gate)
      return
    }
    selected.append(collection.id)
    picker.setSelected(selected)
  }

  /// The app's PickerUnlockSession rule: a grant is used only until 30 s before it expires.
  private func hasLiveGrant(_ id: Int64) -> Bool {
    guard let grant = grants[id] else { return false }
    return grant.expiresAt.timeIntervalSinceNow > 30
  }

  private func askPassword(for collection: ShareCollection, gate: ShareCollection.Gate, error: String? = nil) {
    let alert = UIAlertController(title: collection.name, message: error ?? (gate == .lock ? ShareStrings.lockPrompt : ShareStrings.sharePasswordPrompt), preferredStyle: .alert)
    alert.addTextField { field in
      field.isSecureTextEntry = true
      field.textContentType = .password
      field.placeholder = ShareStrings.password
    }
    alert.addAction(UIAlertAction(title: ShareStrings.cancel, style: .cancel))
    alert.addAction(UIAlertAction(title: ShareStrings.unlock, style: .default) { [weak self, weak alert] _ in
      let password = alert?.textFields?.first?.text ?? ""
      guard let self, !password.isEmpty else { return }
      self.unlock(collection, gate: gate, password: password)
    })
    present(alert, animated: true)
  }

  private func unlock(_ collection: ShareCollection, gate: ShareCollection.Gate, password: String) {
    guard let api else { return }
    Task {
      do {
        let grant = try await api.unlock(collectionId: collection.id, gate: gate, password: password)
        let expiresAt = ISO8601DateFormatter.flexible.date(from: grant.expiresAtUtc) ?? Date().addingTimeInterval(60)
        await MainActor.run {
          self.grants[collection.id] = (grant.unlockToken, expiresAt)
          // Only chosen after the server accepted the password (and only once, however the answers arrive).
          if self.phase == .review, self.saveTask == nil, !self.selected.contains(collection.id) {
            self.selected.append(collection.id)
          }
          self.picker.setSelected(self.selected)
        }
      } catch {
        // Wrong password, too many attempts or offline: the choice stays as it was.
        let message: String
        if let error = error as? ShareAPIError, error.code == "invalidCollectionPassword" {
          message = gate == .lock ? ShareStrings.lockWrongPassword : ShareStrings.sharePasswordWrong
        } else if let error = error as? ShareAPIError, error.status == 429 {
          message = ShareStrings.tooManyAttempts
        } else {
          message = ShareStrings.unlockFailed
        }
        await MainActor.run { self.askPassword(for: collection, gate: gate, error: message) }
      }
    }
  }

  /// "새 컬렉션": the app's create request with its defaults (Folder, Blue), chosen at once. Only the Collection is created here -
  /// the link itself is written by 저장, never before.
  private func askNewCollection(error: String? = nil, name: String? = nil) {
    guard phase == .review, saveTask == nil, !isCreating else { return }
    let alert = UIAlertController(title: ShareStrings.newCollection, message: error, preferredStyle: .alert)
    alert.addTextField { field in
      field.placeholder = ShareStrings.collectionName
      field.text = name
      field.autocapitalizationType = .sentences
      field.returnKeyType = .done
    }
    alert.addAction(UIAlertAction(title: ShareStrings.cancel, style: .cancel))
    alert.addAction(UIAlertAction(title: ShareStrings.create, style: .default) { [weak self, weak alert] _ in
      let typed = (alert?.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard let self, !typed.isEmpty else { return }
      guard typed.count <= 100 else {
        self.askNewCollection(error: ShareStrings.nameTooLong, name: typed)
        return
      }
      self.createCollection(named: typed)
    })
    present(alert, animated: true)
  }

  private func createCollection(named name: String) {
    guard let api else { return }
    isCreating = true
    Task {
      do {
        let created = try await api.createCollection(name: name)
        await MainActor.run {
          self.isCreating = false
          self.createdHere.insert(created, at: 0)
          self.collections.removeAll { $0.id == created.id }
          self.collections.insert(created, at: 0)
          self.picker.insertFirst(created)
          if !self.selected.contains(created.id) { self.selected.append(created.id) }
          self.picker.setSelected(self.selected)
        }
      } catch {
        await MainActor.run {
          self.isCreating = false
          self.askNewCollection(error: Self.createErrorText(error), name: name)
        }
      }
    }
  }

  private static func createErrorText(_ error: Error) -> String {
    if let error = error as? ShareAPIError {
      if error.status == 403, error.code == "subscriptionRequired" { return ShareStrings.subscriptionRequired }
      if error.status == 429 { return ShareStrings.tooManyAttempts }
    }
    return ShareStrings.createFailed
  }

  // MARK: Save

  @objc private func saveReviewed() {
    guard phase == .review, saveTask == nil, !isCreating, let api, let link, let pendingId else { return }
    view.endEditing(true)
    let title = (titleField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let memo = memoView.text.trimmingCharacters(in: .whitespacesAndNewlines)
    // A grant that expired meanwhile: that Collection asks again instead of failing on the server.
    if let expired = selected.compactMap({ id in collections.first { $0.id == id } }).first(where: { $0.gate != nil && !hasLiveGrant($0.id) }) {
      selected.removeAll { $0 == expired.id }
      picker.setSelected(selected)
      askPassword(for: expired, gate: expired.gate!)
      return
    }
    let chosen = selected
    let tokens = Dictionary(uniqueKeysWithValues: chosen.compactMap { id in grants[id].map { (id, $0.token) } })
    setReviewBusy(true)
    errorLabel.isHidden = true
    saveTask = Task {
      do {
        let saved = try await api.saveLink(url: link.absoluteString, clientRequestId: pendingId, collectionIds: chosen, unlockTokens: tokens)
        if !title.isEmpty || !memo.isEmpty {
          try await api.updateDetails(itemId: saved.id, title: title, memo: memo)
        }
        if let previewImageUrl {
          try? await api.setPreviewImage(itemId: saved.id, previewImageUrl: previewImageUrl)
        }
        await MainActor.run { self.finishSaved() }
      } catch {
        await MainActor.run {
          self.saveTask = nil
          self.saveFailed = true
          self.setReviewBusy(false)
          self.errorLabel.text = Self.saveErrorText(error)
          self.errorLabel.isHidden = false
          // The share stays queued for the app: the close button now says so.
          self.closeButton.accessibilityLabel = ShareStrings.closeForLater
        }
      }
    }
  }

  private func setReviewBusy(_ busy: Bool) {
    saveButton.isEnabled = !busy
    closeButton.isEnabled = !busy
    memoView.isEditable = !busy
    picker.isUserInteractionEnabled = !busy
    saveButton.setTitle(busy ? ShareStrings.saving : ShareStrings.save, for: .normal)
  }

  private static func saveErrorText(_ error: Error) -> String {
    if let error = error as? ShareAPIError {
      switch (error.status, error.code) {
      case (401, _): return ShareStrings.sessionExpired
      case (403, "subscriptionRequired"), (403, "collectionOwnerSubscriptionRequired"): return ShareStrings.subscriptionRequired
      case (429, _): return ShareStrings.tooManyAttempts
      case (400, _): return ShareStrings.invalidLink
      case (403, _), (404, _), (409, _): return ShareStrings.collectionUnavailable
      default: break
      }
    }
    return ShareStrings.offline
  }

  // MARK: - Finishing

  /// Only after the server confirmed the save: the queued share is done, and the sheet goes away by itself.
  private func finishSaved() {
    if let pendingId { PendingShareStore.acknowledge(id: pendingId) }
    complete()
  }

  /// 취소 before anything failed: the person decided not to save it - nothing is left behind for the app.
  @objc private func cancelReview() {
    if saveFailed {
      closeKeepingQueue()
      return
    }
    if let pendingId { PendingShareStore.acknowledge(id: pendingId) }
    complete()
  }

  /// Signed out, offline or failed: the share stays queued and opens in the app's 새 링크 검토 next time.
  @objc private func closeKeepingQueue() {
    complete()
  }

  @objc private func dismissWithoutQueue() {
    complete()
  }

  private func complete() {
    guard !finished else { return }
    finished = true
    saveTask?.cancel()
    extensionContext?.completeRequest(returningItems: nil)
  }

  // MARK: - Message card

  private let messageCard = UIStackView()
  private let messageLabel = UILabel()
  private let messageSpinner = UIActivityIndicatorView(style: .medium)
  private let messageButtons = UIStackView()

  private func showMessage(_ text: String, buttons: [(String, Selector)], spinner: Bool = false) {
    if phase != .saving && phase != .reading { phase = .message }
    messageLabel.text = text
    spinner ? messageSpinner.startAnimating() : messageSpinner.stopAnimating()
    messageButtons.arrangedSubviews.forEach { $0.removeFromSuperview() }
    for (index, (title, action)) in buttons.enumerated() {
      let button = UIButton(type: .system)
      button.setTitle(title, for: .normal)
      button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
      button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.addTarget(self, action: action, for: .touchUpInside)
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      if index == 0 {
        button.backgroundColor = SharePalette.brand
        button.setTitleColor(SharePalette.onBrand, for: .normal)
        button.layer.cornerRadius = 12
      }
      messageButtons.addArrangedSubview(button)
    }
    messageButtons.isHidden = buttons.isEmpty
    messageCard.isHidden = false
    scrollView.isHidden = true
    footer.isHidden = true
    footerBackground.isHidden = true
    closeButton.isHidden = true
  }

  // MARK: - Layout

  private func buildLayout() {
    view.backgroundColor = SharePalette.background

    let header = UILabel()
    header.text = "Juple"
    header.font = .preferredFont(forTextStyle: .headline)
    header.adjustsFontForContentSizeCategory = true
    header.textAlignment = .center
    header.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(header)

    // Closing the sheet lives up here (as the app's screen has its back arrow), so the bottom carries only 저장.
    closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(textStyle: .headline)), for: .normal)
    closeButton.tintColor = SharePalette.textPrimary
    closeButton.accessibilityLabel = ShareStrings.close
    closeButton.addTarget(self, action: #selector(cancelReview), for: .touchUpInside)
    closeButton.isHidden = true
    closeButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(closeButton)

    // The message card (reading / saving / signed out / errors).
    messageCard.axis = .vertical
    messageCard.spacing = 16
    messageCard.alignment = .fill
    messageCard.translatesAutoresizingMaskIntoConstraints = false
    messageLabel.font = .preferredFont(forTextStyle: .body)
    messageLabel.adjustsFontForContentSizeCategory = true
    messageLabel.numberOfLines = 0
    messageLabel.textAlignment = .center
    messageLabel.textColor = SharePalette.textPrimary
    messageButtons.axis = .vertical
    messageButtons.spacing = 8
    messageSpinner.hidesWhenStopped = true
    [messageSpinner, messageLabel, messageButtons].forEach(messageCard.addArrangedSubview)
    view.addSubview(messageCard)

    // The review, as the app's 새 링크 검토 (NewLinkReviewScreen): the preview, then the Collections filling the room down to the
    // composer bar (their list scrolls inside). Only when even one row of them does not fit (a small phone with the keyboard up)
    // does this area scroll as a whole, so nothing is ever cut off.
    scrollView.alwaysBounceVertical = false
    scrollView.keyboardDismissMode = .interactive
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.isHidden = true
    view.addSubview(scrollView)
    content.axis = .vertical
    content.spacing = 12
    content.translatesAutoresizingMaskIntoConstraints = false
    scrollView.addSubview(content)

    content.addArrangedSubview(buildPreviewCard())
    content.setCustomSpacing(16, after: content.arrangedSubviews[0])
    content.addArrangedSubview(sectionLabel(ShareStrings.collections))
    wirePicker()
    content.addArrangedSubview(picker)
    picker.setContentHuggingPriority(.defaultLow - 1, for: .vertical)

    // The composer bar (the app's bottomBar): an optional one-line memo that grows to a few lines and then scrolls inside, and the
    // full-width 저장 - riding on the keyboard, above the home indicator otherwise.
    footerBackground.backgroundColor = SharePalette.surface
    footerBackground.isHidden = true
    footerBackground.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(footerBackground)
    let footerBorder = UIView()
    footerBorder.backgroundColor = SharePalette.border
    footerBorder.translatesAutoresizingMaskIntoConstraints = false
    footerBackground.addSubview(footerBorder)

    memoView.font = .preferredFont(forTextStyle: .body)
    memoView.adjustsFontForContentSizeCategory = true
    memoView.backgroundColor = SharePalette.background
    memoView.textColor = SharePalette.textPrimary
    memoView.layer.cornerRadius = 12
    memoView.layer.borderWidth = 1
    memoView.layer.borderColor = SharePalette.border.cgColor
    memoView.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
    memoView.isScrollEnabled = false
    memoView.accessibilityLabel = ShareStrings.memo
    memoView.delegate = self
    memoHeight.isActive = true
    memoPlaceholder.text = ShareStrings.memoPlaceholder
    memoPlaceholder.font = memoView.font
    memoPlaceholder.adjustsFontForContentSizeCategory = true
    memoPlaceholder.textColor = SharePalette.textSecondary
    memoPlaceholder.isAccessibilityElement = false
    memoPlaceholder.translatesAutoresizingMaskIntoConstraints = false
    memoView.addSubview(memoPlaceholder)

    errorLabel.font = .preferredFont(forTextStyle: .footnote)
    errorLabel.adjustsFontForContentSizeCategory = true
    errorLabel.textColor = SharePalette.danger
    errorLabel.numberOfLines = 0
    errorLabel.isHidden = true

    footer.axis = .vertical
    footer.spacing = 8
    footer.translatesAutoresizingMaskIntoConstraints = false
    footer.isHidden = true
    footer.isLayoutMarginsRelativeArrangement = true
    footer.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 16, bottom: 12, trailing: 16)
    saveButton.setTitle(ShareStrings.save, for: .normal)
    saveButton.backgroundColor = SharePalette.brand
    saveButton.setTitleColor(SharePalette.onBrand, for: .normal)
    saveButton.layer.cornerRadius = 12
    saveButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    saveButton.titleLabel?.adjustsFontForContentSizeCategory = true
    saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
    saveButton.addTarget(self, action: #selector(saveReviewed), for: .touchUpInside)
    [errorLabel, memoView, saveButton].forEach(footer.addArrangedSubview)
    view.addSubview(footer)

    // A tap anywhere that is not a text field puts the keyboard away; the tap itself still goes through (a Collection is chosen).
    let dismissTap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
    dismissTap.cancelsTouchesInView = false
    // Never hold back the touch's end: 저장 (or a tile) must get its touch-up where it was pressed, not after the keyboard has gone
    // and the bar has moved away from under the finger.
    dismissTap.delaysTouchesEnded = false
    dismissTap.delegate = self
    view.addGestureRecognizer(dismissTap)

    let margins = view.layoutMarginsGuide
    // The Collections fill the room; when there is less than their minimum, the area scrolls instead.
    let fill = content.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor, constant: -4)
    fill.priority = .defaultLow
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      header.leadingAnchor.constraint(equalTo: closeButton.trailingAnchor, constant: 8),
      header.trailingAnchor.constraint(equalTo: margins.trailingAnchor, constant: -52),
      closeButton.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
      closeButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
      closeButton.widthAnchor.constraint(equalToConstant: 44),
      closeButton.heightAnchor.constraint(equalToConstant: 44),

      messageCard.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      messageCard.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
      messageCard.trailingAnchor.constraint(equalTo: margins.trailingAnchor),

      scrollView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scrollView.bottomAnchor.constraint(equalTo: footer.topAnchor),
      content.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 4),
      content.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
      content.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),
      content.heightAnchor.constraint(greaterThanOrEqualTo: scrollView.frameLayoutGuide.heightAnchor, constant: -4),
      fill,

      footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      // On the keyboard when it is up, on the safe area (above the home indicator) when it is not.
      footer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
      footerBackground.topAnchor.constraint(equalTo: footer.topAnchor),
      footerBackground.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      footerBackground.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      footerBackground.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      footerBorder.topAnchor.constraint(equalTo: footerBackground.topAnchor),
      footerBorder.leadingAnchor.constraint(equalTo: footerBackground.leadingAnchor),
      footerBorder.trailingAnchor.constraint(equalTo: footerBackground.trailingAnchor),
      footerBorder.heightAnchor.constraint(equalToConstant: 1 / max(view.traitCollection.displayScale, 1)),
      memoPlaceholder.topAnchor.constraint(equalTo: memoView.topAnchor, constant: memoView.textContainerInset.top),
      memoPlaceholder.leadingAnchor.constraint(equalTo: memoView.leadingAnchor, constant: memoView.textContainerInset.left + memoView.textContainer.lineFragmentPadding),
      memoPlaceholder.trailingAnchor.constraint(lessThanOrEqualTo: memoView.trailingAnchor, constant: -memoView.textContainerInset.right),
    ])
    updateMemoHeight()
  }

  /// The link card: its picture (or the link placeholder), the title (editable), the site and the address.
  private func buildPreviewCard() -> UIView {
    let card = UIView()
    card.backgroundColor = SharePalette.surface
    card.layer.cornerRadius = 16
    card.accessibilityLabel = ShareStrings.preview

    let imageBox = UIView()
    imageBox.backgroundColor = SharePalette.brandSoft
    imageBox.layer.cornerRadius = 12
    imageBox.clipsToBounds = true
    imageBox.translatesAutoresizingMaskIntoConstraints = false
    thumbnailPlaceholder.tintColor = SharePalette.brand
    thumbnailPlaceholder.contentMode = .scaleAspectFit
    thumbnailPlaceholder.translatesAutoresizingMaskIntoConstraints = false
    thumbnail.contentMode = .scaleAspectFill
    thumbnail.clipsToBounds = true
    thumbnail.isHidden = true
    thumbnail.translatesAutoresizingMaskIntoConstraints = false
    imageBox.addSubview(thumbnailPlaceholder)
    imageBox.addSubview(thumbnail)

    titleField.placeholder = ShareStrings.titlePlaceholder
    titleField.font = .preferredFont(forTextStyle: .headline)
    titleField.adjustsFontForContentSizeCategory = true
    titleField.textColor = SharePalette.textPrimary
    titleField.returnKeyType = .done
    titleField.clearButtonMode = .whileEditing
    titleField.addTarget(titleField, action: #selector(UIResponder.resignFirstResponder), for: .editingDidEndOnExit)
    titleField.addTarget(self, action: #selector(titleEdited), for: .editingChanged)
    titleField.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true

    domainLabel.font = .preferredFont(forTextStyle: .subheadline)
    domainLabel.adjustsFontForContentSizeCategory = true
    domainLabel.textColor = SharePalette.textSecondary
    linkLabel.font = .preferredFont(forTextStyle: .caption1)
    linkLabel.adjustsFontForContentSizeCategory = true
    linkLabel.textColor = SharePalette.textSecondary
    linkLabel.numberOfLines = 1
    linkLabel.lineBreakMode = .byTruncatingMiddle
    // A host and a URL read left to right in every language.
    domainLabel.semanticContentAttribute = .forceLeftToRight
    linkLabel.semanticContentAttribute = .forceLeftToRight

    let texts = UIStackView(arrangedSubviews: [titleField, domainLabel, linkLabel])
    texts.axis = .vertical
    texts.spacing = 2
    texts.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(imageBox)
    card.addSubview(texts)
    NSLayoutConstraint.activate([
      imageBox.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
      imageBox.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
      imageBox.bottomAnchor.constraint(lessThanOrEqualTo: card.bottomAnchor, constant: -12),
      // The card is as tall as its contents (the picture, or the texts when they run longer) - the spare room goes to the
      // Collections below, never to this card.
      { let fit = imageBox.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12); fit.priority = .defaultHigh; return fit }(),
      imageBox.widthAnchor.constraint(equalToConstant: 72),
      imageBox.heightAnchor.constraint(equalToConstant: 72),
      thumbnailPlaceholder.centerXAnchor.constraint(equalTo: imageBox.centerXAnchor),
      thumbnailPlaceholder.centerYAnchor.constraint(equalTo: imageBox.centerYAnchor),
      thumbnailPlaceholder.widthAnchor.constraint(equalToConstant: 28),
      thumbnailPlaceholder.heightAnchor.constraint(equalToConstant: 28),
      thumbnail.topAnchor.constraint(equalTo: imageBox.topAnchor),
      thumbnail.bottomAnchor.constraint(equalTo: imageBox.bottomAnchor),
      thumbnail.leadingAnchor.constraint(equalTo: imageBox.leadingAnchor),
      thumbnail.trailingAnchor.constraint(equalTo: imageBox.trailingAnchor),
      texts.leadingAnchor.constraint(equalTo: imageBox.trailingAnchor, constant: 12),
      texts.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
      texts.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
      texts.bottomAnchor.constraint(lessThanOrEqualTo: card.bottomAnchor, constant: -12),
    ])
    return card
  }

  /// The memo wraps by its width, which is known only after layout (and changes with rotation or a resized sheet).
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    if phase == .review { updateMemoHeight() }
  }

  private func sectionLabel(_ text: String) -> UILabel {
    let label = UILabel()
    label.text = text
    label.font = .preferredFont(forTextStyle: .subheadline)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = SharePalette.textSecondary
    return label
  }
}

extension ShareViewController: UITextViewDelegate, UIGestureRecognizerDelegate {
  func textViewDidChange(_ textView: UITextView) {
    updateMemoHeight()
  }

  /// One line when empty; taller with each line typed up to the app's composer bound, then the memo scrolls inside itself.
  func updateMemoHeight() {
    memoPlaceholder.isHidden = !memoView.text.isEmpty
    let width = memoView.bounds.width > 0 ? memoView.bounds.width : view.bounds.width - 32
    let fitting = memoView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    let height = min(max(fitting, 48), 120)
    memoView.isScrollEnabled = fitting > 120
    if memoHeight.constant != height {
      memoHeight.constant = height
    }
  }

  @objc func dismissKeyboard() {
    view.endEditing(true)
  }

  /// Taps in a text field (the memo, the title, the Collection search) keep the keyboard; any other tap puts it away. Buttons and
  /// other controls (저장, 닫기, the List | Grid switch) are left to themselves: 저장 closes the keyboard as part of saving, and a
  /// dismissal underneath it would move the bar away before the button saw its touch-up - the first tap then only closed the keyboard.
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard let touched = touch.view else { return true }
    if touched is UIControl || touched.superview is UIControl { return false }
    return ![memoView, titleField, picker.searchField, footer].contains { touched.isDescendant(of: $0) }
  }
}

extension ISO8601DateFormatter {
  /// The API's UTC instants, with or without fractional seconds.
  static let flexible: FlexibleISO8601 = FlexibleISO8601()
}

struct FlexibleISO8601 {
  private let withFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private let plain = ISO8601DateFormatter()

  func date(from string: String) -> Date? {
    withFraction.date(from: string) ?? plain.date(from: string)
  }
}

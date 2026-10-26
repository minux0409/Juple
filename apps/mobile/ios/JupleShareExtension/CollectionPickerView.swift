import UIKit

/// The share sheet's Collection picker, laid out like the app's CollectionChoiceGrid (새 링크 검토): 컬렉션 검색, a List | Grid switch, then
/// "새 컬렉션" and "선택 안 함" before the Collections - each its photo, or its icon on its color, with the lock / shared badges and the
/// selection mark. Its list fills the room between the link preview and the memo bar and scrolls inside it. It
/// holds no selection of its own: the controller owns it and asks for a reload.
final class CollectionPickerView: UIView, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout, UISearchBarDelegate {
  enum Mode: String { case list, grid }

  enum Entry {
    case create
    case none
    case collection(ShareCollection)
  }

  var onCreate: (() -> Void)?
  var onNone: (() -> Void)?
  var onToggle: ((ShareCollection) -> Void)?

  private(set) var mode: Mode
  private var all: [ShareCollection] = []
  private var visible: [ShareCollection] = []
  private var selected: Set<Int64> = []
  private var query = ""
  private let images: ShareImageLoader
  private let search = UISearchBar()
  private let toggle = UISegmentedControl(items: [UIImage(systemName: "list.bullet") as Any, UIImage(systemName: "square.grid.2x2") as Any])
  private let collectionView: UICollectionView
  private let status = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)

  /// The app keeps its picker's List | Grid per device (viewModePreference 'categoryPickerViewMode', Grid first); the extension
  /// cannot read the app's storage, so it keeps its own choice the same way, in the App Group (a plain preference, not a secret).
  private static let modeKey = "juple.share.collectionViewMode"

  init(images: ShareImageLoader) {
    self.images = images
    let stored = UserDefaults(suiteName: PendingShareStore.appGroupIdentifier)?.string(forKey: Self.modeKey)
    mode = Mode(rawValue: stored ?? "") ?? .grid
    collectionView = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewFlowLayout())
    super.init(frame: .zero)
    build()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  // MARK: - Data

  func setLoading() {
    all = []
    applyFilter()
    spinner.startAnimating()
    status.isHidden = true
  }

  func setCollections(_ collections: [ShareCollection], failed: Bool) {
    all = collections
    spinner.stopAnimating()
    status.text = failed ? ShareStrings.collectionsFailed : nil
    status.isHidden = !failed
    applyFilter()
  }

  /// A newly created Collection goes first (as in the app) and the list shows it even while a search is typed.
  func insertFirst(_ collection: ShareCollection) {
    all.removeAll { $0.id == collection.id }
    all.insert(collection, at: 0)
    query = ""
    search.text = nil
    applyFilter()
  }

  func setSelected(_ ids: [Int64]) {
    selected = Set(ids)
    collectionView.reloadData()
  }

  private func applyFilter() {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
    visible = needle.isEmpty ? all : all.filter {
      $0.name.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil).contains(needle)
    }
    collectionView.reloadData()
    if !needle.isEmpty, visible.isEmpty, !all.isEmpty {
      status.text = ShareStrings.searchEmpty
      status.isHidden = false
    } else if status.text == ShareStrings.searchEmpty {
      status.isHidden = true
      status.text = nil
    }
  }

  private var entries: [Entry] {
    // While searching, only the matching Collections (as the app's filtered picker).
    (query.isEmpty ? [.create, .none] : []) + visible.map(Entry.collection)
  }

  // MARK: - Collection view

  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { entries.count }

  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(withReuseIdentifier: CollectionChoiceCell.reuseId, for: indexPath) as! CollectionChoiceCell
    let entry = entries[indexPath.item]
    switch entry {
    case .create:
      cell.configure(.create, title: ShareStrings.addNewCollection, selected: false, mode: mode, images: images)
    case .none:
      cell.configure(.none, title: ShareStrings.noCollection, selected: selected.isEmpty, mode: mode, images: images)
    case .collection(let collection):
      cell.configure(.collection(collection), title: collection.name, selected: selected.contains(collection.id), mode: mode, images: images)
    }
    return cell
  }

  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    switch entries[indexPath.item] {
    case .create: onCreate?()
    case .none: onNone?()
    case .collection(let collection): onToggle?(collection)
    }
  }

  func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
    let width = collectionView.bounds.width - 8
    if mode == .list {
      return CGSize(width: max(0, width), height: CollectionChoiceCell.listHeight)
    }
    // 4 columns on a phone; a wider sheet adds columns of about the same size (useCollectionTileColumns).
    let columns = max(4, Int(width / 92))
    return CGSize(width: floor(width / CGFloat(columns)), height: CollectionChoiceCell.gridHeight)
  }

  // MARK: - Search / mode

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    query = searchText
    applyFilter()
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    searchBar.resignFirstResponder()
  }

  @objc private func modeChanged() {
    mode = toggle.selectedSegmentIndex == 0 ? .list : .grid
    UserDefaults(suiteName: PendingShareStore.appGroupIdentifier)?.set(mode.rawValue, forKey: Self.modeKey)
    collectionView.collectionViewLayout.invalidateLayout()
    collectionView.reloadData()
    minimumListHeight.constant = oneRowHeight
  }

  // MARK: - Layout

  private func build() {
    search.searchBarStyle = .minimal
    search.placeholder = ShareStrings.collectionSearch
    search.delegate = self
    search.returnKeyType = .search
    search.translatesAutoresizingMaskIntoConstraints = false

    toggle.selectedSegmentIndex = mode == .list ? 0 : 1
    toggle.addTarget(self, action: #selector(modeChanged), for: .valueChanged)
    toggle.setContentHuggingPriority(.required, for: .horizontal)
    toggle.accessibilityLabel = ShareStrings.viewMode
    toggle.translatesAutoresizingMaskIntoConstraints = false
    if let list = toggle.imageForSegment(at: 0) { list.accessibilityLabel = ShareStrings.viewList }
    if let grid = toggle.imageForSegment(at: 1) { grid.accessibilityLabel = ShareStrings.viewGrid }

    collectionView.backgroundColor = .clear
    collectionView.dataSource = self
    collectionView.delegate = self
    collectionView.keyboardDismissMode = .onDrag
    collectionView.register(CollectionChoiceCell.self, forCellWithReuseIdentifier: CollectionChoiceCell.reuseId)
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    collectionView.layer.cornerRadius = 12
    collectionView.contentInset = UIEdgeInsets(top: 4, left: 4, bottom: 4, right: 4)
    if let flow = collectionView.collectionViewLayout as? UICollectionViewFlowLayout {
      flow.minimumInteritemSpacing = 0
      flow.minimumLineSpacing = 4
    }

    status.font = .preferredFont(forTextStyle: .footnote)
    status.adjustsFontForContentSizeCategory = true
    status.textColor = SharePalette.textSecondary
    status.numberOfLines = 0
    status.isHidden = true
    status.translatesAutoresizingMaskIntoConstraints = false
    spinner.hidesWhenStopped = true
    spinner.translatesAutoresizingMaskIntoConstraints = false

    [search, toggle, collectionView, status, spinner].forEach(addSubview)
    NSLayoutConstraint.activate([
      search.topAnchor.constraint(equalTo: topAnchor),
      search.leadingAnchor.constraint(equalTo: leadingAnchor, constant: -8),
      toggle.leadingAnchor.constraint(equalTo: search.trailingAnchor, constant: 4),
      toggle.trailingAnchor.constraint(equalTo: trailingAnchor),
      toggle.centerYAnchor.constraint(equalTo: search.centerYAnchor),
      toggle.heightAnchor.constraint(greaterThanOrEqualToConstant: 34),

      collectionView.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 4),
      collectionView.leadingAnchor.constraint(equalTo: leadingAnchor),
      collectionView.trailingAnchor.constraint(equalTo: trailingAnchor),
      status.topAnchor.constraint(equalTo: collectionView.bottomAnchor, constant: 4),
      status.leadingAnchor.constraint(equalTo: leadingAnchor),
      status.trailingAnchor.constraint(equalTo: trailingAnchor),
      status.bottomAnchor.constraint(equalTo: bottomAnchor),
      spinner.centerXAnchor.constraint(equalTo: collectionView.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: collectionView.centerYAnchor),
      minimumListHeight,
    ])
    // The list takes whatever height the sheet leaves it (CollectionChoiceGrid's flex: 1).
    collectionView.setContentHuggingPriority(.defaultLow - 1, for: .vertical)
    collectionView.setContentCompressionResistancePriority(.defaultLow - 1, for: .vertical)
  }

  /// One row of tiles (or list rows) with the box's insets: the list never gets smaller than this - when the sheet has no more room
  /// (a small phone with the keyboard up) the review scrolls instead.
  private var oneRowHeight: CGFloat {
    let insets = collectionView.contentInset.top + collectionView.contentInset.bottom
    return (mode == .list ? CollectionChoiceCell.listHeight : CollectionChoiceCell.gridHeight) + insets
  }

  private lazy var minimumListHeight = collectionView.heightAnchor.constraint(greaterThanOrEqualToConstant: oneRowHeight)

  /// The search field, so a tap on it is not taken as "tap outside to close the keyboard".
  var searchField: UIView { search.searchTextField }

  override func layoutSubviews() {
    super.layoutSubviews()
    collectionView.collectionViewLayout.invalidateLayout()
  }
}

/// One tile of the picker: list = icon, name, badges and the selection mark in a row; grid = the icon over its name.
/// One choice, drawn like the app's CollectionChoiceGrid tile (CategoryIconTile + CollectionStatusBadges + SelectionIndicator): the 48pt
/// icon or photo, the lock badge at its top-start and the shared badge at its bottom-start, the brand check circle at its bottom-end
/// when chosen - never a tinted or outlined cell - and the name under it (Grid) or beside it (List).
final class CollectionChoiceCell: UICollectionViewCell {
  static let reuseId = "CollectionChoiceCell"
  /// CategoryIconTile size 48 and its corner radius (radii.md + size / 8).
  static let tileSize: CGFloat = 48
  /// gridCell paddingVertical 10 + tile + label (marginTop 6, one 12pt line) + padding; listCell minHeight 44 with the 48pt tile.
  static let gridHeight: CGFloat = 92
  static let listHeight: CGFloat = 56

  private let tile = UIView()
  private let glyph = UIImageView()
  private let photo = UIImageView()
  private let name = UILabel()
  private let check = SelectionMark()
  private let lock = StatusBadge(symbol: "lock", tint: SharePalette.textPrimary)
  private let shared = StatusBadge(symbol: "person.2", tint: SharePalette.brandText)
  private var listConstraints: [NSLayoutConstraint] = []
  private var gridConstraints: [NSLayoutConstraint] = []
  private var photoTask: Task<Void, Never>?

  override init(frame: CGRect) {
    super.init(frame: frame)
    tile.layer.cornerRadius = 14
    tile.layer.cornerCurve = .continuous
    tile.clipsToBounds = true
    tile.translatesAutoresizingMaskIntoConstraints = false
    glyph.contentMode = .scaleAspectFit
    glyph.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
    glyph.translatesAutoresizingMaskIntoConstraints = false
    photo.contentMode = .scaleAspectFill
    photo.clipsToBounds = true
    photo.translatesAutoresizingMaskIntoConstraints = false
    tile.addSubview(glyph)
    tile.addSubview(photo)
    name.font = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12, weight: .semibold))
    name.adjustsFontForContentSizeCategory = true
    name.textColor = SharePalette.textPrimary
    name.lineBreakMode = .byTruncatingTail
    name.numberOfLines = 1
    name.translatesAutoresizingMaskIntoConstraints = false
    [tile, name, lock, shared, check].forEach(contentView.addSubview)

    NSLayoutConstraint.activate([
      tile.widthAnchor.constraint(equalToConstant: Self.tileSize),
      tile.heightAnchor.constraint(equalToConstant: Self.tileSize),
      glyph.centerXAnchor.constraint(equalTo: tile.centerXAnchor),
      glyph.centerYAnchor.constraint(equalTo: tile.centerYAnchor),
      photo.topAnchor.constraint(equalTo: tile.topAnchor),
      photo.bottomAnchor.constraint(equalTo: tile.bottomAnchor),
      photo.leadingAnchor.constraint(equalTo: tile.leadingAnchor),
      photo.trailingAnchor.constraint(equalTo: tile.trailingAnchor),
      // CollectionStatusBadges: top-start / bottom-start, 4pt outside the tile.
      lock.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: -4),
      lock.topAnchor.constraint(equalTo: tile.topAnchor, constant: -4),
      shared.leadingAnchor.constraint(equalTo: tile.leadingAnchor, constant: -4),
      shared.bottomAnchor.constraint(equalTo: tile.bottomAnchor, constant: 4),
      // CollectionChoiceGrid selectedBadge: bottom -2 / right -2.
      check.trailingAnchor.constraint(equalTo: tile.trailingAnchor, constant: 2),
      check.bottomAnchor.constraint(equalTo: tile.bottomAnchor, constant: 2),
    ])
    listConstraints = [
      tile.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 4),
      tile.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      name.leadingAnchor.constraint(equalTo: tile.trailingAnchor, constant: 12),
      name.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -8),
      name.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
    ]
    gridConstraints = [
      tile.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
      tile.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
      name.topAnchor.constraint(equalTo: tile.bottomAnchor, constant: 6),
      name.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
      name.widthAnchor.constraint(lessThanOrEqualToConstant: 76),
      name.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor, constant: 2),
    ]
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func prepareForReuse() {
    super.prepareForReuse()
    photoTask?.cancel()
    photo.image = nil
    photo.isHidden = true
  }

  func configure(_ entry: CollectionPickerView.Entry, title: String, selected: Bool, mode: CollectionPickerView.Mode, images: ShareImageLoader) {
    NSLayoutConstraint.deactivate(listConstraints + gridConstraints)
    NSLayoutConstraint.activate(mode == .list ? listConstraints : gridConstraints)
    name.text = title
    name.textAlignment = mode == .list ? .natural : .center
    check.isHidden = !selected
    lock.isHidden = true
    shared.isHidden = true
    photo.isHidden = true

    switch entry {
    case .create:
      tile.backgroundColor = SharePalette.brandSoft
      glyph.image = UIImage(systemName: "folder.badge.plus")
      glyph.tintColor = SharePalette.brandText
      check.isHidden = true
      accessibilityLabel = title
      accessibilityTraits = .button
    case .none:
      tile.backgroundColor = SharePalette.surfaceMuted
      glyph.image = UIImage(systemName: "xmark")
      glyph.tintColor = SharePalette.textSecondary
      accessibilityLabel = title
      accessibilityTraits = selected ? [.button, .selected] : .button
    case .collection(let collection):
      let colors = CollectionAppearance.tile(color: collection.color, collectionId: collection.id)
      tile.backgroundColor = colors.background
      glyph.image = CollectionAppearance.symbol(for: collection.icon)
      glyph.tintColor = colors.glyph
      lock.isHidden = collection.gate == nil
      shared.isHidden = !collection.isCollaborative
      var label = title
      if collection.gate != nil { label += ", \(ShareStrings.lockedCollection)" }
      accessibilityLabel = label
      accessibilityTraits = selected ? [.button, .selected] : .button
      if let address = collection.photoUrl {
        photoTask = Task { [weak self] in
          let image = await images.image(from: address, pointSize: Self.tileSize)
          await MainActor.run {
            guard let self, !Task.isCancelled, let image else { return }
            self.photo.image = image
            self.photo.isHidden = false
          }
        }
      }
    }
    isAccessibilityElement = true
  }
}

/// SelectionIndicator (selected): an 18pt brand circle with a 2pt surface ring and a white check.
private final class SelectionMark: UIView {
  private let mark = UIImageView(image: UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 9, weight: .heavy)))

  init() {
    super.init(frame: .zero)
    backgroundColor = SharePalette.brand
    layer.cornerRadius = 9
    layer.borderWidth = 2
    mark.tintColor = .white
    mark.translatesAutoresizingMaskIntoConstraints = false
    translatesAutoresizingMaskIntoConstraints = false
    addSubview(mark)
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: 18),
      heightAnchor.constraint(equalToConstant: 18),
      mark.centerXAnchor.constraint(equalTo: centerXAnchor),
      mark.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
    updateRing()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    updateRing()
  }

  private func updateRing() {
    layer.borderColor = SharePalette.surface.resolvedColor(with: traitCollection).cgColor
  }
}

/// CollectionStatusBadges: an 18pt surface circle with a soft shadow and the glyph at ~62% of it.
private final class StatusBadge: UIView {
  init(symbol: String, tint: UIColor) {
    super.init(frame: .zero)
    backgroundColor = SharePalette.surface
    layer.cornerRadius = 9
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.12
    layer.shadowRadius = 2
    layer.shadowOffset = CGSize(width: 0, height: 1)
    let glyph = UIImageView(image: UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 9, weight: .semibold)))
    glyph.tintColor = tint
    glyph.translatesAutoresizingMaskIntoConstraints = false
    translatesAutoresizingMaskIntoConstraints = false
    addSubview(glyph)
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: 18),
      heightAnchor.constraint(equalToConstant: 18),
      glyph.centerXAnchor.constraint(equalTo: centerXAnchor),
      glyph.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

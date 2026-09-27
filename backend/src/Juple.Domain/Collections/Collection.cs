namespace Juple.Domain.Collections;

/// <summary>
/// A user-named bucket of saved URLs (the "보관함" feature) - distinct from Category (a single-
/// select tag on an Item) in that an Item can belong to any number of Collections at once. See
/// CollectionItem for the Item membership join.
/// </summary>
public sealed class Collection
{
    private Collection()
    {
    }

    // color trails with a default (unlike icon) so every existing positional call site that never
    // cared about color (test fixtures, seeding) keeps compiling unchanged - see Collection.Color's
    // own remarks on why null ("no explicit color") is itself a completely valid, common state.
    public Collection(
        long userId,
        string name,
        string nameNormalized,
        CollectionIcon icon,
        DateTimeOffset createdAtUtc,
        string? color = null)
    {
        UserId = userId;
        Name = name;
        NameNormalized = nameNormalized;
        Icon = icon;
        Color = color;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = createdAtUtc;
    }

    public Collection(
        long userId,
        string name,
        string nameNormalized,
        CollectionIcon icon,
        DateTimeOffset createdAtUtc,
        CollectionColor color)
        : this(userId, name, nameNormalized, icon, createdAtUtc, color.ToString())
    {
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Name { get; private set; } = null!;

    /// <summary>
    /// Comparison-only value (never displayed): the trimmed Name, culture-invariant-uppercased.
    /// Backs the UserId+NameNormalized unique index so duplicate-name detection is deterministic
    /// regardless of the database's default collation - see CollectionConfiguration.
    /// </summary>
    public string NameNormalized { get; private set; } = null!;

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public DateTimeOffset? DeletedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>
    /// The OWNER's own favorite mark (legacy, pre-dates per-user favorites). During the favorites
    /// transition it stays authoritative for the Owner: a previous API revision reads and writes
    /// only this column, and the current one reads it for the Owner and writes it together with the
    /// Owner's CollectionFavorite row in one transaction (see CollectionStore.SetFavoriteAsync).
    /// Contributors' marks exist only in CollectionFavorites. A later cleanup round, after
    /// FinalizeCollectionFavoriteTransition, can switch Owner reads to CollectionFavorites and drop it.
    /// </summary>
    public bool IsFavorite { get; private set; }

    /// <summary>Decorative only - see CollectionIcon. Every Collection has one; a new one defaults to Folder.</summary>
    public CollectionIcon Icon { get; private set; }

    /// <summary>Decorative only. Holds a backward-compatible preset name or a validated custom
    /// #RRGGBB value; null means "fall back to the existing id-deterministic palette".</summary>
    public string? Color { get; private set; }

    /// <summary>
    /// Collection lock (see Lock/RemoveLock) - an extra gate on top of access rights, never a
    /// substitute for them: content is released only to someone who already has access (Owner,
    /// Contributor, Viewer, or an active public share) AND has proven the Owner's lock password
    /// (UserCollectionLockSettings - one per Owner, see CollectionLockPasswordSource).
    /// LockPasswordHash is a legacy per-Collection password hash (never the password, never returned
    /// by any DTO): it still opens the Collection only while its Owner has no lock password row, and
    /// is kept (never dropped here) for rolling-deploy safety until a later cleanup migration.
    /// </summary>
    public bool IsLocked { get; private set; }

    public string? LockPasswordHash { get; private set; }

    /// <summary>
    /// Bumped on every lock set/change/removal; unlock grants embed the version they were issued
    /// for, so any change immediately invalidates every outstanding grant (no revocation list).
    /// </summary>
    public int LockVersion { get; private set; }

    public DateTimeOffset? LockPasswordChangedAtUtc { get; private set; }

    /// <summary>Callers must pass an already-normalized (trimmed, non-empty) name/nameNormalized pair.</summary>
    public void Rename(string name, string nameNormalized, DateTimeOffset updatedAtUtc)
    {
        if (Name == name)
        {
            return;
        }

        Name = name;
        NameNormalized = nameNormalized;
        UpdatedAtUtc = updatedAtUtc;
    }

    public void SetFavorite(bool isFavorite, DateTimeOffset updatedAtUtc)
    {
        if (IsFavorite == isFavorite)
        {
            return;
        }

        IsFavorite = isFavorite;
        UpdatedAtUtc = updatedAtUtc;
    }

    public void SetIcon(CollectionIcon icon, DateTimeOffset updatedAtUtc)
    {
        if (Icon == icon)
        {
            return;
        }

        Icon = icon;
        UpdatedAtUtc = updatedAtUtc;
    }

    /// <summary>Always sets an explicit, non-null color - there is no "clear back to the
    /// deterministic-palette fallback" action once a Collection has one (mirrors SetIcon).</summary>
    public void SetColor(string color, DateTimeOffset updatedAtUtc)
    {
        if (Color == color)
        {
            return;
        }

        Color = color;
        UpdatedAtUtc = updatedAtUtc;
    }

    public void SetColor(CollectionColor color, DateTimeOffset updatedAtUtc) => SetColor(color.ToString(), updatedAtUtc);

    /// <summary>
    /// Locks the Collection under its Owner's lock password - no password of its own is created.
    /// No-op when already locked. The caller checks that the Owner has a lock password.
    /// </summary>
    public void Lock(DateTimeOffset changedAtUtc)
    {
        if (IsLocked)
        {
            return;
        }

        IsLocked = true;
        LockVersion++;
        LockPasswordChangedAtUtc = changedAtUtc;
        UpdatedAtUtc = changedAtUtc;
    }

    /// <summary>No-op when not locked; otherwise clears the hash and invalidates every outstanding grant.</summary>
    public void RemoveLock(DateTimeOffset changedAtUtc)
    {
        if (!IsLocked)
        {
            return;
        }

        IsLocked = false;
        LockPasswordHash = null;
        LockVersion++;
        LockPasswordChangedAtUtc = changedAtUtc;
        UpdatedAtUtc = changedAtUtc;
    }

    public void SoftDelete(DateTimeOffset deletedAtUtc)
    {
        if (DeletedAtUtc is null)
        {
            DeletedAtUtc = deletedAtUtc;
        }
    }

    public void Restore()
    {
        DeletedAtUtc = null;
    }
}

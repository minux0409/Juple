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
        CollectionColor? color = null)
    {
        UserId = userId;
        Name = name;
        NameNormalized = nameNormalized;
        Icon = icon;
        Color = color;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = createdAtUtc;
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

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>
    /// A user preference on this Collection (quick-access pinning in the Collections list), not a
    /// separate resource - defaults to false for every newly-created Collection.
    /// </summary>
    public bool IsFavorite { get; private set; }

    /// <summary>Decorative only - see CollectionIcon. Every Collection has one; a new one defaults to Folder.</summary>
    public CollectionIcon Icon { get; private set; }

    /// <summary>Decorative only - see CollectionColor's own remarks on why this is nullable (unlike
    /// Icon): null means "fall back to the existing id-deterministic palette", not "no color".</summary>
    public CollectionColor? Color { get; private set; }

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
    public void SetColor(CollectionColor color, DateTimeOffset updatedAtUtc)
    {
        if (Color == color)
        {
            return;
        }

        Color = color;
        UpdatedAtUtc = updatedAtUtc;
    }
}

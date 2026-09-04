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

    public Collection(long userId, string name, string nameNormalized, DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        Name = name;
        NameNormalized = nameNormalized;
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
}

using System.Globalization;

namespace Juple.Application.Collections;

/// <summary>
/// Shared Create/Rename normalization: trim outer whitespace, reject a missing or whitespace-only
/// value (Name is required), enforce the 100-character limit - mirrors CategoryNameNormalizer.
/// Additionally computes NameNormalized (culture-invariant uppercase of the trimmed value) so the
/// UserId+NameNormalized uniqueness check is deterministic regardless of the database's default
/// collation, unlike Category's UserId+Name unique index.
/// </summary>
internal static class CollectionNameNormalizer
{
    internal static (string Name, string NameNormalized) Normalize(string? name)
    {
        var trimmedName = name?.Trim();
        if (string.IsNullOrEmpty(trimmedName))
        {
            throw new InvalidCollectionException("name", "Name is required.");
        }

        if (trimmedName.Length > 100)
        {
            throw new InvalidCollectionException("name", "Name must be 100 characters or fewer.");
        }

        return (trimmedName, trimmedName.ToUpperInvariant());
    }
}

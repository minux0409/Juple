using Juple.Application.Items;

namespace Juple.Application.Collections.ListCollections;

/// <summary>
/// The Collections list's text search (optional q): a Collection is kept when its NAME contains the term or when one of its links
/// does (title or URL, which carries the host) - for a term of ANY length, so what is searched never depends on how much was typed.
/// Never the memo, and never the links of a Collection whose content is behind a lock / access password: see CollectionStore). The term is
/// the user's own text: it becomes a LIKE "contains" pattern with its wildcards escaped (<see cref="ItemSearchPattern"/>) and is only
/// ever a parameter.
/// </summary>
public sealed record CollectionListSearch(string Pattern, string PrefixPattern = "")
{
    public const int MinLength = 1;

    public const int MaxLength = ItemSearchPattern.MaxLength;

    /// <summary>Null for no search (null / blank); false when the (trimmed) term is longer than <see cref="MaxLength"/>.</summary>
    public static bool TryCreate(string? term, out CollectionListSearch? search)
    {
        search = null;
        var trimmed = term?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        if (trimmed.Length is < MinLength or > MaxLength)
        {
            return false;
        }

        search = new CollectionListSearch(ItemSearchPattern.ToContainsPattern(trimmed), ItemSearchPattern.ToPrefixPattern(trimmed));
        return true;
    }
}

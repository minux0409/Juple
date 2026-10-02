namespace Juple.Application.Items;

/// <summary>
/// The Archive search term as a safe SQL LIKE "contains" pattern (escape character '\\'). The term is
/// the user's own text: % _ [ and the escape character are escaped so they match literally, and the
/// pattern is only ever passed as a parameter - never concatenated into SQL.
/// </summary>
public static class ItemSearchPattern
{
    public const string EscapeCharacter = "\\";

    /// <summary>Shorter terms are refused: a 1-character contains search matches nearly everything.</summary>
    public const int MinLength = 2;

    public const int MaxLength = 100;

    /// <summary>The trimmed term, or null when it is empty, too short or too long.</summary>
    public static string? Normalize(string? term)
    {
        var trimmed = term?.Trim();
        return trimmed is { Length: >= MinLength and <= MaxLength } ? trimmed : null;
    }

    public static string ToContainsPattern(string term)
    {
        var escaped = term
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal)
            .Replace("[", "\\[", StringComparison.Ordinal);
        return "%" + escaped + "%";
    }
}

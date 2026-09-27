using System.Globalization;

namespace Juple.Domain.Users;

/// <summary>
/// The optional, user-chosen name other people see in collaboration (participants, invitations,
/// exact Juple ID lookup). Unlike the Juple ID it is not unique, not an identifier and never used
/// for lookup - two people may both be "피카츄". Any script and emoji are allowed; the text is kept
/// exactly as typed apart from trimming surrounding whitespace.
/// </summary>
public static class UserDisplayName
{
    /// <summary>User-perceived characters (text elements), so an emoji counts once.</summary>
    public const int MaxTextElements = 30;

    /// <summary>
    /// Technical cap in UTF-16 code units - exactly the column size (nvarchar(512)), so every value
    /// this validator accepts is storable. 30 text elements normally need far less (a 30-emoji ZWJ
    /// family name is ~240); only pathological input (e.g. hundreds of combining marks on one
    /// letter) reaches it, and is rejected here, never by the database.
    /// </summary>
    public const int MaxStorageLength = 512;

    /// <summary>
    /// Trims, maps empty to null (no name - clients show the Juple ID instead), and rejects control
    /// characters, line/paragraph separators and invisible formatting characters other than the
    /// zero-width (non-)joiner that emoji sequences and several scripts need - so a name can neither
    /// span lines nor visually reorder or hide the text around it.
    /// </summary>
    public static bool TryNormalize(string? input, out string? displayName, out string? error)
    {
        displayName = null;
        error = null;
        var trimmed = input?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        foreach (var character in trimmed)
        {
            var category = char.GetUnicodeCategory(character);
            var isAllowedJoiner = character is '‌' or '‍';
            if (category is UnicodeCategory.Control or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator
                || (category == UnicodeCategory.Format && !isAllowedJoiner))
            {
                error = "Display name must not contain line breaks or control characters.";
                return false;
            }
        }

        if (trimmed.Length > MaxStorageLength || new StringInfo(trimmed).LengthInTextElements > MaxTextElements)
        {
            error = $"Display name must be at most {MaxTextElements} characters.";
            return false;
        }

        displayName = trimmed;
        return true;
    }
}

using System.Globalization;
using System.Text;

namespace Juple.Domain.Users;

/// <summary>
/// The optional, user-chosen name (nickname) other people see in collaboration (participants,
/// invitations, friends, exact Juple ID lookup). Unlike the Juple ID it is not unique, not an
/// identifier and never used for lookup - two people may both be "피카츄". Any script and emoji
/// are allowed; the text is kept as typed apart from Unicode NFC normalization (canonically
/// equivalent, so it looks identical) and trimming surrounding whitespace.
///
/// This type owns only the character/length rules. Reserved (impersonation) and prohibited
/// (abusive) names are a separate, list-driven policy in Juple.Application (NicknamePolicy), which
/// every nickname write goes through after this.
/// </summary>
public static class UserDisplayName
{
    /// <summary>User-perceived characters (text elements), so an emoji counts once.</summary>
    public const int MaxTextElements = 30;

    /// <summary>
    /// Technical cap in UTF-16 code units - exactly the column size (nvarchar(512)), so every value
    /// this validator accepts is storable. 30 text elements normally need far less (a 30-emoji ZWJ
    /// family name is ~240); only pathological input (e.g. one enormous emoji ZWJ chain) reaches
    /// it, and is rejected here, never by the database.
    /// </summary>
    public const int MaxStorageLength = 512;

    /// <summary>
    /// Combining marks allowed on one user-perceived character. Real scripts need at most a few
    /// (Thai vowel + tone, Arabic shadda + vowel, Vietnamese after NFC); more is "Zalgo" text that
    /// draws over the lines around it. Emoji variation selectors are not counted.
    /// </summary>
    public const int MaxCombiningMarksPerTextElement = 4;

    /// <summary>
    /// Trims, maps empty to null (no name - clients show the Juple ID instead), NFC-normalizes, and
    /// rejects anything that can hide, reorder or break the surrounding text: control characters,
    /// line/paragraph separators, invisible formatting characters (other than the zero-width
    /// (non-)joiner that emoji sequences and several scripts need, and the tag characters of a
    /// subdivision flag emoji), invisible "filler" letters, unusual space characters, private-use
    /// characters and malformed UTF-16.
    /// </summary>
    public static bool TryNormalize(string? input, out string? displayName, out UserDisplayNameError? error)
    {
        displayName = null;
        error = null;
        var trimmed = input?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        string normalized;
        try
        {
            normalized = trimmed.Normalize(NormalizationForm.FormC);
        }
        catch (ArgumentException)
        {
            // Unpaired surrogate - not text.
            error = UserDisplayNameError.InvalidCharacters;
            return false;
        }

        if (!HasOnlyAllowedCharacters(normalized))
        {
            error = UserDisplayNameError.InvalidCharacters;
            return false;
        }

        if (normalized.Length > MaxStorageLength || new StringInfo(normalized).LengthInTextElements > MaxTextElements)
        {
            error = UserDisplayNameError.TooLong;
            return false;
        }

        displayName = normalized;
        return true;
    }

    private static bool HasOnlyAllowedCharacters(string value)
    {
        var textElements = StringInfo.GetTextElementEnumerator(value);
        while (textElements.MoveNext())
        {
            var element = textElements.GetTextElement();
            var startsWithBlackFlag = element.StartsWith("\U0001F3F4", StringComparison.Ordinal);
            var combiningMarks = 0;
            foreach (var rune in element.EnumerateRunes())
            {
                if (rune == Rune.ReplacementChar && !element.Contains('\uFFFD'))
                {
                    return false;
                }

                if (!IsAllowedRune(rune, startsWithBlackFlag))
                {
                    return false;
                }

                var category = Rune.GetUnicodeCategory(rune);
                if (category is UnicodeCategory.NonSpacingMark or UnicodeCategory.EnclosingMark
                    && !IsVariationSelector(rune.Value)
                    && ++combiningMarks > MaxCombiningMarksPerTextElement)
                {
                    return false;
                }
            }
        }

        return true;
    }

    private static bool IsAllowedRune(Rune rune, bool inSubdivisionFlag)
    {
        var value = rune.Value;
        if (InvisibleLookalikes.Contains(value))
        {
            return false;
        }

        switch (Rune.GetUnicodeCategory(rune))
        {
            case UnicodeCategory.Control:
            case UnicodeCategory.LineSeparator:
            case UnicodeCategory.ParagraphSeparator:
            case UnicodeCategory.PrivateUse:
            case UnicodeCategory.Surrogate:
                return false;
            case UnicodeCategory.SpaceSeparator:
                // An ordinary space, or the ideographic space CJK names use - never the
                // no-break/fixed-width spaces that make one name look like another.
                return value is 0x0020 or 0x3000;
            case UnicodeCategory.Format:
                // ZWNJ/ZWJ (emoji ZWJ sequences, Persian/Indic shaping), and the tag characters
                // that only ever spell a subdivision flag after U+1F3F4 (England/Scotland/Wales).
                return value is 0x200C or 0x200D
                    || (inSubdivisionFlag && value is >= 0xE0020 and <= 0xE007F);
            default:
                return true;
        }
    }

    private static bool IsVariationSelector(int value) =>
        value is >= 0xFE00 and <= 0xFE0F or >= 0xE0100 and <= 0xE01EF;

    /// <summary>
    /// Letters/marks/symbols that render as nothing (or a blank) yet are not Format characters -
    /// the usual way to make an "empty" or look-alike name slip past a whitespace check.
    /// </summary>
    private static readonly HashSet<int> InvisibleLookalikes =
    [
        0x034F, // combining grapheme joiner
        0x115F, 0x1160, // Hangul choseong/jungseong fillers
        0x17B4, 0x17B5, // Khmer inherent vowels
        0x180B, 0x180C, 0x180D, 0x180F, // Mongolian free variation selectors
        0x2800, // braille pattern blank
        0x3164, // Hangul filler
        0xFFA0, // halfwidth Hangul filler
    ];
}

/// <summary>Why a nickname failed the character/length rules. Mapped to stable API codes by the caller.</summary>
public enum UserDisplayNameError
{
    TooLong,
    InvalidCharacters,
}

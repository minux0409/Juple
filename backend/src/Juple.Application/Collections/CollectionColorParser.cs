using Juple.Domain.Collections;

namespace Juple.Application.Collections;

/// <summary>
/// Shared Create/SetColor parsing - mirrors CollectionIconParser exactly, with one difference: a
/// missing/empty value defaults to Default (Blue), the same concrete, non-null value the create
/// UI's own preview starts on - never null. Null only ever exists on a row that predates this
/// feature (see Collection.Color's own remarks); this parser is never the source of that null.
/// </summary>
internal static class CollectionColorParser
{
    internal const string Default = nameof(CollectionColor.Blue);

    internal static string Parse(string? color)
    {
        if (string.IsNullOrEmpty(color))
        {
            return Default;
        }

        if (Enum.TryParse(color, out CollectionColor parsed) && Enum.IsDefined(parsed))
        {
            return parsed.ToString();
        }

        if (color.Length == 7 && color[0] == '#' && color[1..].All(Uri.IsHexDigit))
        {
            return color.ToUpperInvariant();
        }

        throw new InvalidCollectionException("color", "Color must be one of the supported Collection colors.");
    }
}

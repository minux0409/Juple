using Juple.Domain.Collections;

namespace Juple.Application.Collections;

/// <summary>
/// Shared Create/SetIcon parsing: a missing/empty value defaults to Folder (see this round's
/// "선택 안 하면 기본 아이콘 자동 지정"), a non-empty value must exactly name one of CollectionIcon's
/// fixed members (case-sensitive - the client is expected to echo back exactly what a CollectionDto
/// handed it, never a guess/derivation of its own).
/// </summary>
internal static class CollectionIconParser
{
    internal static CollectionIcon Parse(string? icon)
    {
        if (string.IsNullOrEmpty(icon))
        {
            return CollectionIcon.Folder;
        }

        if (!Enum.TryParse(icon, out CollectionIcon parsed) || !Enum.IsDefined(parsed))
        {
            throw new InvalidCollectionException("icon", "Icon must be one of the supported Collection icons.");
        }

        return parsed;
    }
}

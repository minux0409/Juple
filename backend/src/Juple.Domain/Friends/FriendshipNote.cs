using System.Globalization;

namespace Juple.Domain.Friends;

/// <summary>
/// One user's private note about a friend ("회사 개발팀 김민수"). Visible only to its author - never
/// to the friend, never in any Collection, invitation, participant or public DTO.
/// </summary>
public sealed class FriendshipNote
{
    private FriendshipNote()
    {
    }

    public FriendshipNote(long friendshipId, long userId, string note, DateTimeOffset updatedAtUtc)
    {
        FriendshipId = friendshipId;
        UserId = userId;
        Note = note;
        UpdatedAtUtc = updatedAtUtc;
    }

    public long Id { get; private set; }

    public long FriendshipId { get; private set; }

    public long UserId { get; private set; }

    public string Note { get; private set; } = null!;

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public void Update(string note, DateTimeOffset updatedAtUtc)
    {
        Note = note;
        UpdatedAtUtc = updatedAtUtc;
    }
}

/// <summary>
/// Validation for a friend note: plain single-line text, trimmed (empty clears the note), at most
/// <see cref="MaxTextElements"/> user-perceived characters AND at most <see cref="MaxStorageLength"/>
/// UTF-16 units - exactly the column size, so every accepted value is storable.
/// </summary>
public static class FriendNoteText
{
    public const int MaxTextElements = 200;

    public const int MaxStorageLength = 1000;

    public static bool TryNormalize(string? input, out string? note, out string? error)
    {
        note = null;
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
                error = "Note must not contain line breaks or control characters.";
                return false;
            }
        }

        if (trimmed.Length > MaxStorageLength || new StringInfo(trimmed).LengthInTextElements > MaxTextElements)
        {
            error = $"Note must be at most {MaxTextElements} characters.";
            return false;
        }

        note = trimmed;
        return true;
    }
}

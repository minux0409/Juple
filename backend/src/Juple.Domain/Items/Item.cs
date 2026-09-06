namespace Juple.Domain.Items;

public sealed class Item
{
    private Item()
    {
    }

    public Item(long userId, string url, DateTimeOffset savedAtUtc)
    {
        UserId = userId;
        Url = url;
        SavedAtUtc = savedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Url { get; private set; } = null!;

    public DateTimeOffset SavedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    public string? Title { get; private set; }

    public string? Memo { get; private set; }

    /// <summary>
    /// Replaces the user-owned Title/Memo. Callers must pass already-normalized values (trimmed,
    /// empty collapsed to null) - this method only applies them and is a no-op when both are
    /// already at the requested values, so an unchanged edit does not touch RowVersion.
    /// </summary>
    public void UpdateDetails(string? title, string? memo)
    {
        if (Title == title && Memo == memo)
        {
            return;
        }

        Title = title;
        Memo = memo;
    }
}

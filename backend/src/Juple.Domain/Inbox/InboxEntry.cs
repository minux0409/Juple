namespace Juple.Domain.Inbox;

public sealed class InboxEntry
{
    private InboxEntry()
    {
    }

    public InboxEntry(long userId, string url, DateTimeOffset savedAtUtc)
    {
        UserId = userId;
        Url = url;
        SavedAtUtc = savedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Url { get; private set; } = null!;

    public DateTimeOffset SavedAtUtc { get; private set; }
}
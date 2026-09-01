namespace Juple.Domain.Items;

public sealed class Item
{
    private Item()
    {
    }

    public Item(long userId, string url, Guid? clientRequestId, DateTimeOffset savedAtUtc)
    {
        UserId = userId;
        Url = url;
        ClientRequestId = clientRequestId;
        SavedAtUtc = savedAtUtc;
        State = ItemState.Inbox;
        StateChangedAtUtc = savedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Url { get; private set; } = null!;

    public Guid? ClientRequestId { get; private set; }

    public DateTimeOffset SavedAtUtc { get; private set; }

    public ItemState State { get; private set; }

    public DateTimeOffset StateChangedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];
}

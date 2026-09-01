namespace Juple.Domain.Items;

/// <summary>
/// Durable idempotency ledger for a save request that carried a clientRequestId (a Share save).
/// Deliberately independent of <see cref="Item"/>'s own lifecycle: <see cref="ItemId"/> is a
/// historical identifier only (not a foreign key), so a future hard-delete of the Item can never
/// invalidate replay of an already-acknowledged save request.
/// </summary>
public sealed class ItemSaveRequest
{
    private ItemSaveRequest()
    {
    }

    public ItemSaveRequest(long userId, Guid clientRequestId, long itemId, string url, DateTimeOffset savedAtUtc)
    {
        UserId = userId;
        ClientRequestId = clientRequestId;
        ItemId = itemId;
        Url = url;
        SavedAtUtc = savedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public Guid ClientRequestId { get; private set; }

    public long ItemId { get; private set; }

    public string Url { get; private set; } = null!;

    public DateTimeOffset SavedAtUtc { get; private set; }
}

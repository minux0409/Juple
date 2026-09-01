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
        State = ItemState.Inbox;
        StateChangedAtUtc = savedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Url { get; private set; } = null!;

    public DateTimeOffset SavedAtUtc { get; private set; }

    public ItemState State { get; private set; }

    public DateTimeOffset StateChangedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    public string? Title { get; private set; }

    public string? Memo { get; private set; }

    public long? CategoryId { get; private set; }

    /// <summary>
    /// Replaces the user-owned Title/Memo. Callers must pass already-normalized values (trimmed,
    /// empty collapsed to null) - this method only applies them and is a no-op when both are
    /// already at the requested values, so an unchanged edit does not touch RowVersion. Does not
    /// affect State or StateChangedAtUtc.
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

    /// <summary>
    /// Sets or clears (null) the owning Category. Callers are responsible for verifying the
    /// Category, when non-null, is owned by this Item's UserId - this method only applies the id.
    /// </summary>
    public void AssignCategory(long? categoryId)
    {
        if (CategoryId == categoryId)
        {
            return;
        }

        CategoryId = categoryId;
    }

    public void MoveToWishlist(DateTimeOffset changedAtUtc)
    {
        if (State == ItemState.Wishlist)
        {
            return;
        }

        State = ItemState.Wishlist;
        StateChangedAtUtc = changedAtUtc;
    }

    public void MoveToArchive(DateTimeOffset changedAtUtc)
    {
        if (State == ItemState.Archived)
        {
            return;
        }

        State = ItemState.Archived;
        StateChangedAtUtc = changedAtUtc;
    }
}

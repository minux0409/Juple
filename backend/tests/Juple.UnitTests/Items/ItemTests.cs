using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemTests
{
    private static readonly DateTimeOffset SavedAt = new(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Constructor_SetsInboxStateAndStateChangedAtUtcToSavedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);

        Assert.Equal(ItemState.Inbox, item.State);
        Assert.Equal(SavedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToWishlist_FromInbox_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);
        var changedAt = SavedAt.AddHours(1);

        item.MoveToWishlist(changedAt);

        Assert.Equal(ItemState.Wishlist, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToArchive_FromInbox_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);
        var changedAt = SavedAt.AddHours(1);

        item.MoveToArchive(changedAt);

        Assert.Equal(ItemState.Archived, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToArchive_FromWishlist_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);
        item.MoveToWishlist(SavedAt.AddHours(1));
        var changedAt = SavedAt.AddHours(2);

        item.MoveToArchive(changedAt);

        Assert.Equal(ItemState.Archived, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToWishlist_FromArchived_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);
        item.MoveToArchive(SavedAt.AddHours(1));
        var changedAt = SavedAt.AddHours(2);

        item.MoveToWishlist(changedAt);

        Assert.Equal(ItemState.Wishlist, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToWishlist_WhenAlreadyWishlist_IsNoOpAndKeepsStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);
        var firstChange = SavedAt.AddHours(1);
        item.MoveToWishlist(firstChange);

        item.MoveToWishlist(firstChange.AddMinutes(5));

        Assert.Equal(ItemState.Wishlist, item.State);
        Assert.Equal(firstChange, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToArchive_WhenAlreadyArchived_IsNoOpAndKeepsStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", null, SavedAt);
        var firstChange = SavedAt.AddHours(1);
        item.MoveToArchive(firstChange);

        item.MoveToArchive(firstChange.AddMinutes(5));

        Assert.Equal(ItemState.Archived, item.State);
        Assert.Equal(firstChange, item.StateChangedAtUtc);
    }
}

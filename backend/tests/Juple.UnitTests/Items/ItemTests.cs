using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemTests
{
    private static readonly DateTimeOffset SavedAt = new(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Constructor_SetsInboxStateAndStateChangedAtUtcToSavedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);

        Assert.Equal(ItemState.Inbox, item.State);
        Assert.Equal(SavedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToWishlist_FromInbox_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        var changedAt = SavedAt.AddHours(1);

        item.MoveToWishlist(changedAt);

        Assert.Equal(ItemState.Wishlist, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToArchive_FromInbox_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        var changedAt = SavedAt.AddHours(1);

        item.MoveToArchive(changedAt);

        Assert.Equal(ItemState.Archived, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToArchive_FromWishlist_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.MoveToWishlist(SavedAt.AddHours(1));
        var changedAt = SavedAt.AddHours(2);

        item.MoveToArchive(changedAt);

        Assert.Equal(ItemState.Archived, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToWishlist_FromArchived_ChangesStateAndStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.MoveToArchive(SavedAt.AddHours(1));
        var changedAt = SavedAt.AddHours(2);

        item.MoveToWishlist(changedAt);

        Assert.Equal(ItemState.Wishlist, item.State);
        Assert.Equal(changedAt, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToWishlist_WhenAlreadyWishlist_IsNoOpAndKeepsStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        var firstChange = SavedAt.AddHours(1);
        item.MoveToWishlist(firstChange);

        item.MoveToWishlist(firstChange.AddMinutes(5));

        Assert.Equal(ItemState.Wishlist, item.State);
        Assert.Equal(firstChange, item.StateChangedAtUtc);
    }

    [Fact]
    public void MoveToArchive_WhenAlreadyArchived_IsNoOpAndKeepsStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        var firstChange = SavedAt.AddHours(1);
        item.MoveToArchive(firstChange);

        item.MoveToArchive(firstChange.AddMinutes(5));

        Assert.Equal(ItemState.Archived, item.State);
        Assert.Equal(firstChange, item.StateChangedAtUtc);
    }

    [Fact]
    public void Constructor_SetsTitleAndMemoToNull()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);

        Assert.Null(item.Title);
        Assert.Null(item.Memo);
    }

    [Fact]
    public void UpdateDetails_SetsTitle()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);

        item.UpdateDetails("My Title", null);

        Assert.Equal("My Title", item.Title);
        Assert.Null(item.Memo);
    }

    [Fact]
    public void UpdateDetails_SetsMemo()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);

        item.UpdateDetails(null, "My memo\nsecond line");

        Assert.Null(item.Title);
        Assert.Equal("My memo\nsecond line", item.Memo);
    }

    [Fact]
    public void UpdateDetails_SetsBothTitleAndMemo()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);

        item.UpdateDetails("My Title", "My memo");

        Assert.Equal("My Title", item.Title);
        Assert.Equal("My memo", item.Memo);
    }

    [Fact]
    public void UpdateDetails_WithSameValues_IsNoOp()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.UpdateDetails("My Title", "My memo");

        item.UpdateDetails("My Title", "My memo");

        Assert.Equal("My Title", item.Title);
        Assert.Equal("My memo", item.Memo);
    }

    [Fact]
    public void UpdateDetails_CanClearBackToNull()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.UpdateDetails("My Title", "My memo");

        item.UpdateDetails(null, null);

        Assert.Null(item.Title);
        Assert.Null(item.Memo);
    }

    [Fact]
    public void MoveToWishlist_PreservesTitleAndMemo()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.UpdateDetails("My Title", "My memo");

        item.MoveToWishlist(SavedAt.AddHours(1));

        Assert.Equal("My Title", item.Title);
        Assert.Equal("My memo", item.Memo);
    }

    [Fact]
    public void MoveToArchive_PreservesTitleAndMemo()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.UpdateDetails("My Title", "My memo");

        item.MoveToArchive(SavedAt.AddHours(1));

        Assert.Equal("My Title", item.Title);
        Assert.Equal("My memo", item.Memo);
    }

    [Fact]
    public void UpdateDetails_DoesNotChangeStateChangedAtUtc()
    {
        var item = new Item(17, "https://shop.example/item", SavedAt);
        item.MoveToWishlist(SavedAt.AddHours(1));

        item.UpdateDetails("My Title", "My memo");

        Assert.Equal(SavedAt.AddHours(1), item.StateChangedAtUtc);
    }
}

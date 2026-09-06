using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemTests
{
    private static readonly DateTimeOffset SavedAt = new(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);

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
}

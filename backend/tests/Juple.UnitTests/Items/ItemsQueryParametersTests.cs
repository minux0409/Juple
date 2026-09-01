using Juple.Api.Items;
using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemsQueryParametersTests
{
    [Fact]
    public void TryParseState_WhenWishlist_ReturnsWishlistState()
    {
        var parsed = ItemsQueryParameters.TryParseState("wishlist", out var state);

        Assert.True(parsed);
        Assert.Equal(ItemState.Wishlist, state);
    }

    [Fact]
    public void TryParseState_WhenArchived_ReturnsArchivedState()
    {
        var parsed = ItemsQueryParameters.TryParseState("archived", out var state);

        Assert.True(parsed);
        Assert.Equal(ItemState.Archived, state);
    }

    [Theory]
    [InlineData("inbox")]
    [InlineData("foo")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("1")]
    [InlineData("2")]
    public void TryParseState_WhenNotWishlistOrArchived_ReturnsFalse(string? value)
    {
        var parsed = ItemsQueryParameters.TryParseState(value, out _);

        Assert.False(parsed);
    }

    [Fact]
    public void TryParseLimit_WhenAbsent_ReturnsDefaultLimit()
    {
        var parsed = ItemsQueryParameters.TryParseLimit(null, out var limit);

        Assert.True(parsed);
        Assert.Equal(ItemsQueryParameters.DefaultLimit, limit);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    [InlineData(50)]
    public void TryParseLimit_WhenWithinRange_ReturnsThatLimit(int value)
    {
        var parsed = ItemsQueryParameters.TryParseLimit(value, out var limit);

        Assert.True(parsed);
        Assert.Equal(value, limit);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public void TryParseLimit_WhenOutOfRange_ReturnsFalse(int value)
    {
        var parsed = ItemsQueryParameters.TryParseLimit(value, out _);

        Assert.False(parsed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void TryParseCategoryId_WhenAbsent_ReturnsNull(string? value)
    {
        var parsed = ItemsQueryParameters.TryParseCategoryId(value, out var categoryId);

        Assert.True(parsed);
        Assert.Null(categoryId);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("42")]
    public void TryParseCategoryId_WhenPositiveInteger_ReturnsThatId(string value)
    {
        var parsed = ItemsQueryParameters.TryParseCategoryId(value, out var categoryId);

        Assert.True(parsed);
        Assert.Equal(long.Parse(value), categoryId);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("abc")]
    [InlineData("1.5")]
    public void TryParseCategoryId_WhenInvalid_ReturnsFalse(string value)
    {
        var parsed = ItemsQueryParameters.TryParseCategoryId(value, out _);

        Assert.False(parsed);
    }
}

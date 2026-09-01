using Juple.Api.Items;
using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemStateWireFormatTests
{
    [Theory]
    [InlineData(ItemState.Inbox, "inbox")]
    [InlineData(ItemState.Wishlist, "wishlist")]
    [InlineData(ItemState.Archived, "archived")]
    public void ToWireValue_ReturnsLowercaseWireValue(ItemState state, string expected)
    {
        var wireValue = ItemStateWireFormat.ToWireValue(state);

        Assert.Equal(expected, wireValue);
    }

    [Fact]
    public void ToWireValue_WhenStateIsUnknown_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => ItemStateWireFormat.ToWireValue((ItemState)99));
    }
}

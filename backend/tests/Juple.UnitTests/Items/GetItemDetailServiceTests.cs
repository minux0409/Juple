using Juple.Application.Items;
using Juple.Application.Items.GetItemDetail;
using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class GetItemDetailServiceTests
{
    [Fact]
    public async Task GetAsync_WhenItemExists_ReturnsDetails()
    {
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", "My Title", "My memo", DateTimeOffset.UtcNow,
            ItemState.Wishlist, DateTimeOffset.UtcNow);
        var store = new FakeItemDetailQueryStore { Details = expected };
        var service = new GetItemDetailService(store);

        var result = await service.GetAsync(17, 41);

        Assert.Equal(expected, result);
        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
    }

    [Fact]
    public async Task GetAsync_WhenItemDoesNotExist_ThrowsItemNotFoundException()
    {
        var store = new FakeItemDetailQueryStore { Details = null };
        var service = new GetItemDetailService(store);

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.GetAsync(17, 41));
    }

    private sealed class FakeItemDetailQueryStore : IItemDetailQueryStore
    {
        public ItemDetailsDto? Details { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public Task<ItemDetailsDto?> GetDetailsAsync(
            long userId,
            long itemId,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastItemId = itemId;
            return Task.FromResult(Details);
        }
    }
}

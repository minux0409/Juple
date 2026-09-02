using Juple.Application.Purchases;
using Juple.Application.Purchases.GetPurchaseDetail;

namespace Juple.UnitTests.Purchases;

public sealed class GetPurchaseDetailServiceTests
{
    [Fact]
    public async Task GetAsync_WhenPurchaseExists_ReturnsIt()
    {
        var expected = new PurchaseDto(
            41, 9, "Sunscreen", new DateOnly(2026, 8, 15), 19900m, "KRW", "Coupang", "250ml", 1m, "note",
            DateTimeOffset.UtcNow);
        var store = new FakePurchaseStore { Purchase = expected };
        var service = new GetPurchaseDetailService(store);

        var result = await service.GetAsync(17, 41);

        Assert.Equal(expected, result);
        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastPurchaseId);
    }

    [Fact]
    public async Task GetAsync_WhenPurchaseDoesNotExist_ThrowsPurchaseNotFoundException()
    {
        var store = new FakePurchaseStore { Purchase = null };
        var service = new GetPurchaseDetailService(store);

        await Assert.ThrowsAsync<PurchaseNotFoundException>(() => service.GetAsync(17, 41));
    }

    private sealed class FakePurchaseStore : IPurchaseStore
    {
        public PurchaseDto? Purchase { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastPurchaseId { get; private set; }

        public Task<PurchasePage> ListAsync(
            long userId, PurchasePageCursor? cursor, int limit, long? itemId = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(new PurchasePage([], null));

        public Task<PurchaseDto?> GetAsync(
            long userId, long purchaseId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastPurchaseId = purchaseId;
            return Task.FromResult(Purchase);
        }

        public Task<PurchaseDto> CreateAsync(
            long userId, PurchaseFields fields, DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task UpdateAsync(
            long userId, long purchaseId, PurchaseFields fields, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteAsync(long userId, long purchaseId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}

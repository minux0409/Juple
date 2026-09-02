using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Application.Purchases.UpdatePurchase;

namespace Juple.UnitTests.Purchases;

public sealed class UpdatePurchaseServiceTests
{
    private static readonly DateOnly ValidDate = new(2026, 8, 15);

    [Fact]
    public async Task UpdateAsync_NormalizesFieldsBeforeCallingStore()
    {
        var store = new FakePurchaseStore();
        var service = new UpdatePurchaseService(store);

        await service.UpdateAsync(17, 41, Command(productName: "  Sunscreen  "));

        Assert.Equal("Sunscreen", store.LastFields!.ProductName);
        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastPurchaseId);
    }

    [Fact]
    public async Task UpdateAsync_WhenProductNameIsMissing_ThrowsInvalidPurchaseAndDoesNotCallStore()
    {
        var store = new FakePurchaseStore();
        var service = new UpdatePurchaseService(store);

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.UpdateAsync(17, 41, Command(productName: null)));

        Assert.Equal("productName", exception.Field);
        Assert.False(store.WasUpdateCalled);
    }

    [Fact]
    public async Task UpdateAsync_WhenPurchaseDateIsMissing_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new UpdatePurchaseService(store);
        var command = new UpdatePurchaseCommand(
            null, "Product", null, null, null, null, null, null, null);

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.UpdateAsync(17, 41, command));

        Assert.Equal("purchaseDate", exception.Field);
    }

    [Fact]
    public async Task UpdateAsync_SupportsReassigningItemIdToAnotherItem()
    {
        var store = new FakePurchaseStore();
        var service = new UpdatePurchaseService(store);

        await service.UpdateAsync(17, 41, Command(itemId: 55));

        Assert.Equal(55, store.LastFields!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_SupportsClearingItemIdToNull()
    {
        var store = new FakePurchaseStore();
        var service = new UpdatePurchaseService(store);

        await service.UpdateAsync(17, 41, Command(itemId: null));

        Assert.Null(store.LastFields!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_WhenPurchaseIsMissingOrOtherUsers_PropagatesPurchaseNotFoundException()
    {
        var store = new FakePurchaseStore { ThrowPurchaseNotFound = true };
        var service = new UpdatePurchaseService(store);

        await Assert.ThrowsAsync<PurchaseNotFoundException>(() => service.UpdateAsync(17, 41, Command()));
    }

    [Fact]
    public async Task UpdateAsync_WhenReassignedItemIsNotOwnedByCurrentUser_PropagatesItemNotFoundException()
    {
        var store = new FakePurchaseStore { ThrowItemNotFound = true };
        var service = new UpdatePurchaseService(store);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.UpdateAsync(17, 41, Command(itemId: 99)));
    }

    private static UpdatePurchaseCommand Command(
        long? itemId = null,
        string? productName = "Product",
        DateOnly? purchaseDate = null,
        decimal? amount = null,
        string? currencyCode = null,
        string? store = null,
        string? variant = null,
        decimal? quantity = null,
        string? memo = null) =>
        new(
            itemId,
            productName,
            purchaseDate ?? ValidDate,
            amount,
            currencyCode,
            store,
            variant,
            quantity,
            memo);

    private sealed class FakePurchaseStore : IPurchaseStore
    {
        public bool ThrowPurchaseNotFound { get; init; }

        public bool ThrowItemNotFound { get; init; }

        public bool WasUpdateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastPurchaseId { get; private set; }

        public PurchaseFields? LastFields { get; private set; }

        public Task<PurchasePage> ListAsync(
            long userId, PurchasePageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult(new PurchasePage([], null));

        public Task<PurchaseDto?> GetAsync(
            long userId, long purchaseId, CancellationToken cancellationToken = default) =>
            Task.FromResult<PurchaseDto?>(null);

        public Task<PurchaseDto> CreateAsync(
            long userId, PurchaseFields fields, DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task UpdateAsync(
            long userId, long purchaseId, PurchaseFields fields, CancellationToken cancellationToken = default)
        {
            WasUpdateCalled = true;
            LastUserId = userId;
            LastPurchaseId = purchaseId;
            LastFields = fields;

            if (ThrowPurchaseNotFound)
            {
                throw new PurchaseNotFoundException();
            }

            if (ThrowItemNotFound)
            {
                throw new ItemNotFoundException();
            }

            return Task.CompletedTask;
        }

        public Task DeleteAsync(long userId, long purchaseId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}

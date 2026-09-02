using Juple.Application.Items;
using Juple.Application.RepeatPurchases;
using Juple.Application.RepeatPurchases.UpdateRepeatPurchase;
using Juple.Domain.Purchases;

namespace Juple.UnitTests.RepeatPurchases;

public sealed class UpdateRepeatPurchaseServiceTests
{
    private static readonly DateOnly ValidNextPurchaseDate = new(2026, 9, 30);
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 29, 10, 0, 0, TimeSpan.Zero);
    private static readonly byte[] ClientVersion = [1, 2, 3, 4, 5, 6, 7, 8];

    [Fact]
    public async Task UpdateAsync_NormalizesFieldsBeforeCallingStore()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.UpdateAsync(17, 41, Command(productName: "  Sunscreen  "), ClientVersion);

        Assert.Equal("Sunscreen", store.LastFields!.ProductName);
        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastRepeatPurchaseId);
    }

    [Fact]
    public async Task UpdateAsync_WhenProductNameIsMissing_ThrowsInvalidRepeatPurchaseAndDoesNotCallStore()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.UpdateAsync(17, 41, Command(productName: null), ClientVersion));

        Assert.Equal("productName", exception.Field);
        Assert.False(store.WasUpdateCalled);
    }

    [Fact]
    public async Task UpdateAsync_WhenNextPurchaseDateIsMissing_ThrowsInvalidRepeatPurchase()
    {
        // Bypasses the Command() helper (whose `??` default would mask a null here) - mirrors
        // UpdatePurchaseServiceTests' identical direct-construction technique.
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));
        var command = new UpdateRepeatPurchaseCommand(
            null, "Product", 30, IntervalUnit.Day, null, false, 0);

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.UpdateAsync(17, 41, command, ClientVersion));

        Assert.Equal("nextPurchaseDate", exception.Field);
    }

    [Fact]
    public async Task UpdateAsync_SupportsReassigningItemIdToAnotherItem()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.UpdateAsync(17, 41, Command(itemId: 55), ClientVersion);

        Assert.Equal(55, store.LastFields!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_SupportsClearingItemIdToNull()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.UpdateAsync(17, 41, Command(itemId: null), ClientVersion);

        Assert.Null(store.LastFields!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_PassesClientVersionThroughUnchanged()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.UpdateAsync(17, 41, Command(), ClientVersion);

        Assert.Equal(ClientVersion, store.LastExpectedVersion);
    }

    [Fact]
    public async Task UpdateAsync_UsesTimeProviderForUpdatedAtUtc_NotAnyClientInput()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.UpdateAsync(17, 41, Command(), ClientVersion);

        Assert.Equal(FixedNow, store.LastUpdatedAtUtc);
    }

    [Fact]
    public async Task UpdateAsync_WhenItemIsNotOwnedByCurrentUser_PropagatesItemNotFoundException()
    {
        var store = new FakeRepeatPurchaseStore { ThrowItemNotFound = true };
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.UpdateAsync(17, 41, Command(itemId: 99), ClientVersion));
    }

    [Fact]
    public async Task UpdateAsync_WhenStoreVersionDoesNotMatch_PropagatesRepeatPurchaseConcurrencyException()
    {
        var store = new FakeRepeatPurchaseStore { ThrowConcurrencyConflict = true };
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await Assert.ThrowsAsync<RepeatPurchaseConcurrencyException>(
            () => service.UpdateAsync(17, 41, Command(), ClientVersion));
    }

    [Fact]
    public async Task UpdateAsync_WhenRepeatPurchaseIsMissing_PropagatesRepeatPurchaseNotFoundException()
    {
        var store = new FakeRepeatPurchaseStore { ThrowNotFound = true };
        var service = new UpdateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(
            () => service.UpdateAsync(17, 41, Command(), ClientVersion));
    }

    private static UpdateRepeatPurchaseCommand Command(
        long? itemId = null,
        string? productName = "Product",
        int? intervalValue = 30,
        IntervalUnit intervalUnit = IntervalUnit.Day,
        DateOnly? nextPurchaseDate = null,
        bool isReminderEnabled = false,
        int reminderLeadDays = 0) =>
        new(
            itemId,
            productName,
            intervalValue,
            intervalUnit,
            nextPurchaseDate ?? ValidNextPurchaseDate,
            isReminderEnabled,
            reminderLeadDays);

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakeRepeatPurchaseStore : IRepeatPurchaseStore
    {
        public bool ThrowItemNotFound { get; init; }

        public bool ThrowConcurrencyConflict { get; init; }

        public bool ThrowNotFound { get; init; }

        public bool WasUpdateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastRepeatPurchaseId { get; private set; }

        public RepeatPurchaseFields? LastFields { get; private set; }

        public byte[]? LastExpectedVersion { get; private set; }

        public DateTimeOffset? LastUpdatedAtUtc { get; private set; }

        public Task<RepeatPurchasePage> ListAsync(
            long userId, RepeatPurchasePageCursor? cursor, int limit, long? itemId, bool includeDisabled,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new RepeatPurchasePage([], null));

        public Task<RepeatPurchaseDto?> GetAsync(
            long userId, long repeatPurchaseId, CancellationToken cancellationToken = default) =>
            Task.FromResult<RepeatPurchaseDto?>(null);

        public Task<RepeatPurchaseDto> CreateAsync(
            long userId, RepeatPurchaseFields fields, DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RepeatPurchaseDto> UpdateAsync(
            long userId,
            long repeatPurchaseId,
            RepeatPurchaseFields fields,
            byte[] expectedVersion,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasUpdateCalled = true;
            LastUserId = userId;
            LastRepeatPurchaseId = repeatPurchaseId;
            LastFields = fields;
            LastExpectedVersion = expectedVersion;
            LastUpdatedAtUtc = updatedAtUtc;

            if (ThrowNotFound)
            {
                throw new RepeatPurchaseNotFoundException();
            }

            if (ThrowItemNotFound)
            {
                throw new ItemNotFoundException();
            }

            if (ThrowConcurrencyConflict)
            {
                throw new RepeatPurchaseConcurrencyException(new InvalidOperationException("stale version"));
            }

            return Task.FromResult(new RepeatPurchaseDto(
                repeatPurchaseId, fields.ItemId, fields.ProductName, fields.IntervalValue, fields.IntervalUnit,
                fields.NextPurchaseDate, fields.IsReminderEnabled, fields.ReminderLeadDays, true, updatedAtUtc,
                updatedAtUtc, [9, 9, 9, 9, 9, 9, 9, 9]));
        }

        public Task<RepeatPurchaseDto> EnableAsync(
            long userId, long repeatPurchaseId, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RepeatPurchaseDto> DisableAsync(
            long userId, long repeatPurchaseId, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}

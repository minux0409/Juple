using Juple.Application.Items;
using Juple.Application.RepeatPurchases;
using Juple.Application.RepeatPurchases.CreateRepeatPurchase;
using Juple.Domain.Purchases;

namespace Juple.UnitTests.RepeatPurchases;

public sealed class CreateRepeatPurchaseServiceTests
{
    private static readonly DateOnly ValidNextPurchaseDate = new(2026, 9, 30);
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 29, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task CreateAsync_TrimsProductNameOuterWhitespace()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(productName: "  Sunscreen  "));

        Assert.Equal("Sunscreen", store.LastFields!.ProductName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateAsync_WhenProductNameIsMissingOrWhitespaceOnly_ThrowsInvalidRepeatPurchase(
        string? productName)
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.CreateAsync(17, Command(productName: productName)));

        Assert.Equal("productName", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenProductNameExceeds500Characters_ThrowsInvalidRepeatPurchase()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.CreateAsync(17, Command(productName: new string('a', 501))));

        Assert.Equal("productName", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenProductNameIsExactly500Characters_Succeeds()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));
        var maxLengthName = new string('a', 500);

        await service.CreateAsync(17, Command(productName: maxLengthName));

        Assert.Equal(maxLengthName, store.LastFields!.ProductName);
    }

    [Fact]
    public async Task CreateAsync_WhenIntervalValueIsMissing_ThrowsInvalidRepeatPurchase()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.CreateAsync(17, Command(intervalValue: null)));

        Assert.Equal("intervalValue", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task CreateAsync_WhenIntervalValueIsZeroOrNegative_ThrowsInvalidRepeatPurchase(int intervalValue)
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.CreateAsync(17, Command(intervalValue: intervalValue)));

        Assert.Equal("intervalValue", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_PassesIntervalUnitThrough()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(intervalUnit: IntervalUnit.Month));

        Assert.Equal(IntervalUnit.Month, store.LastFields!.IntervalUnit);
    }

    [Fact]
    public async Task CreateAsync_WhenNextPurchaseDateIsMissing_ThrowsInvalidRepeatPurchase_NeverDefaultsToToday()
    {
        // Bypasses the Command() helper (whose `??` default would mask a null here) - mirrors
        // CreatePurchaseServiceTests' identical direct-construction technique for its own
        // "date is required, never defaulted" test. Explicit regression for "Backend가 오늘을
        // 계산/default 하지 않는다": a missing date must fail loudly, never silently resolve to
        // TimeProvider's "now".
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));
        var command = new CreateRepeatPurchaseCommand(
            null, "Product", 30, IntervalUnit.Day, null, false, 0);

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.CreateAsync(17, command));

        Assert.Equal("nextPurchaseDate", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenReminderLeadDaysIsNegative_ThrowsInvalidRepeatPurchase()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(
            () => service.CreateAsync(17, Command(reminderLeadDays: -1)));

        Assert.Equal("reminderLeadDays", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenReminderLeadDaysIsZero_Succeeds()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(isReminderEnabled: true, reminderLeadDays: 0));

        Assert.Equal(0, store.LastFields!.ReminderLeadDays);
    }

    [Fact]
    public async Task CreateAsync_PassesItemIdThroughUnvalidated_StoreIsResponsibleForOwnershipCheck()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(itemId: 99));

        Assert.Equal(99, store.LastFields!.ItemId);
    }

    [Fact]
    public async Task CreateAsync_WhenItemIsNotOwnedByCurrentUser_PropagatesItemNotFoundException()
    {
        var store = new FakeRepeatPurchaseStore { ThrowItemNotFound = true };
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.CreateAsync(17, Command(itemId: 99)));
    }

    [Fact]
    public async Task CreateAsync_UsesTimeProviderForCreatedAtUtc_NotAnyClientInput()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command());

        Assert.Equal(FixedNow, store.LastCreatedAtUtc);
    }

    [Fact]
    public async Task CreateAsync_CallsStoreWithCurrentUser()
    {
        var store = new FakeRepeatPurchaseStore();
        var service = new CreateRepeatPurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command());

        Assert.Equal(17, store.LastUserId);
    }

    private static CreateRepeatPurchaseCommand Command(
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

    internal sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    internal sealed class FakeRepeatPurchaseStore : IRepeatPurchaseStore
    {
        public bool ThrowItemNotFound { get; init; }

        public bool WasCreateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public RepeatPurchaseFields? LastFields { get; private set; }

        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

        public Task<RepeatPurchasePage> ListAsync(
            long userId, RepeatPurchasePageCursor? cursor, int limit, long? itemId, bool includeDisabled,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new RepeatPurchasePage([], null));

        public Task<RepeatPurchaseDto?> GetAsync(
            long userId, long repeatPurchaseId, CancellationToken cancellationToken = default) =>
            Task.FromResult<RepeatPurchaseDto?>(null);

        public Task<RepeatPurchaseDto> CreateAsync(
            long userId,
            RepeatPurchaseFields fields,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasCreateCalled = true;
            LastUserId = userId;
            LastFields = fields;
            LastCreatedAtUtc = createdAtUtc;

            if (ThrowItemNotFound)
            {
                throw new ItemNotFoundException();
            }

            return Task.FromResult(new RepeatPurchaseDto(
                1, fields.ItemId, fields.ProductName, fields.IntervalValue, fields.IntervalUnit,
                fields.NextPurchaseDate, fields.IsReminderEnabled, fields.ReminderLeadDays, true, createdAtUtc,
                createdAtUtc, [1, 2, 3, 4, 5, 6, 7, 8]));
        }

        public Task<RepeatPurchaseDto> UpdateAsync(
            long userId, long repeatPurchaseId, RepeatPurchaseFields fields, byte[] expectedVersion,
            DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

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

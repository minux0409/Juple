using System.Data.Common;
using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Application.RepeatPurchases;
using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.RepeatPurchases;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Juple.IntegrationTests.RepeatPurchases;

public sealed class LogPurchaseStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;
    private long _itemId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run LogPurchase store integration " +
                "tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/log-purchase-test", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.Purchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.RepeatPurchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private async Task<RepeatPurchaseDto> CreateRepeatPurchaseAsync(
        long userId,
        long? itemId = null,
        string productName = "Repeat Test Product",
        int intervalValue = 30,
        IntervalUnit intervalUnit = IntervalUnit.Day,
        bool isEnabled = true)
    {
        var store = new RepeatPurchaseStore(_dbContext);
        var created = await store.CreateAsync(
            userId,
            new RepeatPurchaseFields(
                itemId, productName, intervalValue, intervalUnit, new DateOnly(2026, 9, 30), false, 0),
            DateTimeOffset.UtcNow);
        if (!isEnabled)
        {
            created = await store.DisableAsync(userId, created.Id, DateTimeOffset.UtcNow);
        }

        _dbContext.ChangeTracker.Clear();
        return created;
    }

    private static PurchaseFields LogFields(
        long? itemId,
        string productName,
        DateOnly purchaseDate,
        decimal? amount = null,
        string? currencyCode = null,
        string? store = null,
        string? variant = null,
        decimal? quantity = null,
        string? memo = null) =>
        new(itemId, productName, purchaseDate, amount, currencyCode, store, variant, quantity, memo);

    private LogPurchaseStore NewStore() => new(_dbContext);

    [Fact]
    public async Task LogAsync_CreatesPurchaseLinkedToRepeatPurchaseWithServerCopiedItemIdAndProductName()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, _itemId, "Sunscreen 250ml");

        var result = await store.LogAsync(
            _userId,
            repeatPurchase.Id,
            LogFields(_itemId, "Sunscreen 250ml", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version,
            DateTimeOffset.UtcNow);

        Assert.True(result.Purchase.Id > 0);
        Assert.Equal(_itemId, result.Purchase.ItemId);
        Assert.Equal("Sunscreen 250ml", result.Purchase.ProductName);

        _dbContext.ChangeTracker.Clear();
        var persisted = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == result.Purchase.Id);
        Assert.Equal(repeatPurchase.Id, persisted.RepeatPurchaseId);
    }

    [Theory]
    [InlineData(IntervalUnit.Day, 30, "2026-09-01", "2026-10-01")]
    [InlineData(IntervalUnit.Week, 2, "2026-09-01", "2026-09-15")]
    [InlineData(IntervalUnit.Month, 3, "2026-09-01", "2026-12-01")]
    public async Task LogAsync_AdvancesNextPurchaseDateByInterval(
        IntervalUnit unit, int value, string purchaseDateText, string expectedNextDateText)
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, intervalValue: value, intervalUnit: unit);
        var purchaseDate = DateOnly.Parse(purchaseDateText);

        var result = await store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", purchaseDate), repeatPurchase.Version,
            DateTimeOffset.UtcNow);

        Assert.Equal(DateOnly.Parse(expectedNextDateText), result.RepeatPurchase.NextPurchaseDate);
    }

    [Fact]
    public async Task LogAsync_Month_JanuaryThirtyFirstPlusOneMonth_ClampsToFebruaryTwentyEighth()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, intervalValue: 1, intervalUnit: IntervalUnit.Month);

        var result = await store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", new DateOnly(2026, 1, 31)),
            repeatPurchase.Version, DateTimeOffset.UtcNow);

        Assert.Equal(new DateOnly(2026, 2, 28), result.RepeatPurchase.NextPurchaseDate);
    }

    [Fact]
    public async Task LogAsync_OverwritesAnyPriorManualNextPurchaseDate()
    {
        var store = NewStore();
        var repeatPurchaseStore = new RepeatPurchaseStore(_dbContext);
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, intervalValue: 10, intervalUnit: IntervalUnit.Day);
        // Simulates a user manually overriding NextPurchaseDate via PUT before ever logging a purchase.
        var manuallyOverridden = await repeatPurchaseStore.UpdateAsync(
            _userId,
            repeatPurchase.Id,
            new RepeatPurchaseFields(
                null, "Repeat Test Product", 10, IntervalUnit.Day, new DateOnly(2099, 1, 1), false, 0),
            repeatPurchase.Version,
            DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", new DateOnly(2026, 9, 1)),
            manuallyOverridden.Version, DateTimeOffset.UtcNow);

        Assert.Equal(new DateOnly(2026, 9, 11), result.RepeatPurchase.NextPurchaseDate);
    }

    [Fact]
    public async Task LogAsync_PreservesDecimalStringPrecisionThroughAmountAndQuantity()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId);
        const decimal maxAmount = 999_999_999_999_999.9999m;
        const decimal maxQuantity = 999_999_999_999_999.999m;

        var result = await store.LogAsync(
            _userId,
            repeatPurchase.Id,
            LogFields(
                null, "Product", new DateOnly(2026, 9, 1), maxAmount, "KRW", null, null, maxQuantity),
            repeatPurchase.Version,
            DateTimeOffset.UtcNow);

        Assert.Equal(maxAmount, result.Purchase.Amount);
        Assert.Equal(maxQuantity, result.Purchase.Quantity);

        _dbContext.ChangeTracker.Clear();
        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == result.Purchase.Id);
        Assert.Equal(maxAmount, reloaded.Amount);
        Assert.Equal(maxQuantity, reloaded.Quantity);
    }

    [Fact]
    public async Task LogAsync_WithStaleVersion_ThrowsRepeatPurchaseConcurrencyExceptionAndCreatesNoPurchase()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId);
        var staleVersion = repeatPurchase.Version;

        // Someone else's plain field edit lands first, advancing RowVersion past what this caller read.
        var repeatPurchaseStore = new RepeatPurchaseStore(_dbContext);
        await repeatPurchaseStore.UpdateAsync(
            _userId,
            repeatPurchase.Id,
            new RepeatPurchaseFields(
                null, "Repeat Test Product", 30, IntervalUnit.Day, new DateOnly(2026, 9, 30), false, 0),
            staleVersion,
            DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<RepeatPurchaseConcurrencyException>(() => store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", new DateOnly(2026, 9, 1)), staleVersion,
            DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var purchaseCount = await _dbContext.Purchases.CountAsync(p => p.UserId == _userId);
        Assert.Equal(0, purchaseCount);
        var reloaded = await repeatPurchaseStore.GetAsync(_userId, repeatPurchase.Id);
        // NextPurchaseDate must still reflect the successful prior update, not the rejected log-purchase.
        Assert.Equal(new DateOnly(2026, 9, 30), reloaded!.NextPurchaseDate);
    }

    [Fact]
    public async Task LogAsync_WhenPurchaseItemIdDoesNotExist_ThrowsItemNotFoundAndLeavesRepeatPurchaseUnchanged()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId);
        var originalNextPurchaseDate = repeatPurchase.NextPurchaseDate;
        var originalVersion = repeatPurchase.Version;

        // Deliberately inconsistent PurchaseFields (itemId that was never valid) to force the
        // Purchase INSERT itself to fail on FK_Purchases_Items_ItemId, independent of any
        // RepeatPurchase concurrency conflict - proving that failure alone also rolls back the
        // RepeatPurchase's NextPurchaseDate change within the same transaction.
        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(-1, "Product", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var purchaseCount = await _dbContext.Purchases.CountAsync(p => p.UserId == _userId);
        Assert.Equal(0, purchaseCount);
        var repeatPurchaseStore = new RepeatPurchaseStore(_dbContext);
        var reloaded = await repeatPurchaseStore.GetAsync(_userId, repeatPurchase.Id);
        Assert.Equal(originalNextPurchaseDate, reloaded!.NextPurchaseDate);
        Assert.Equal(originalVersion, reloaded.Version);
    }

    [Fact]
    public async Task LogAsync_WhenIntervalOverflowsDateOnlyRange_ThrowsInvalidRepeatPurchaseAndCreatesNoPurchase()
    {
        var store = NewStore();
        // int.MaxValue weeks overflows int arithmetic (IntervalValue * 7) long before it could ever
        // land inside DateOnly's range - must be rejected cleanly, never silently wrapped.
        var repeatPurchase = await CreateRepeatPurchaseAsync(
            _userId, intervalValue: int.MaxValue, intervalUnit: IntervalUnit.Week);
        var originalNextPurchaseDate = repeatPurchase.NextPurchaseDate;
        var originalVersion = repeatPurchase.Version;

        await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(() => store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var purchaseCount = await _dbContext.Purchases.CountAsync(p => p.UserId == _userId);
        Assert.Equal(0, purchaseCount);
        var repeatPurchaseStore = new RepeatPurchaseStore(_dbContext);
        var reloaded = await repeatPurchaseStore.GetAsync(_userId, repeatPurchase.Id);
        Assert.Equal(originalNextPurchaseDate, reloaded!.NextPurchaseDate);
        Assert.Equal(originalVersion, reloaded.Version);
    }

    [Fact]
    public async Task LogAsync_WhenPurchaseDateIsAtDateOnlyMaxValue_ThrowsInvalidRepeatPurchaseAndCreatesNoPurchase()
    {
        var store = NewStore();
        // A purchaseDate this close to DateOnly.MaxValue combined with any positive interval pushes
        // the computed NextPurchaseDate past the representable range.
        var repeatPurchase = await CreateRepeatPurchaseAsync(
            _userId, intervalValue: 1, intervalUnit: IntervalUnit.Day);
        var originalNextPurchaseDate = repeatPurchase.NextPurchaseDate;
        var originalVersion = repeatPurchase.Version;

        await Assert.ThrowsAsync<InvalidRepeatPurchaseException>(() => store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", DateOnly.MaxValue),
            repeatPurchase.Version, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var purchaseCount = await _dbContext.Purchases.CountAsync(p => p.UserId == _userId);
        Assert.Equal(0, purchaseCount);
        var repeatPurchaseStore = new RepeatPurchaseStore(_dbContext);
        var reloaded = await repeatPurchaseStore.GetAsync(_userId, repeatPurchase.Id);
        Assert.Equal(originalNextPurchaseDate, reloaded!.NextPurchaseDate);
        Assert.Equal(originalVersion, reloaded.Version);
    }

    [Fact]
    public async Task LogAsync_TwoConcurrentRequests_ExactlyOneSucceedsAndOneConflicts()
    {
        var seedStore = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        await using var contextA = new JupleDbContext(options);
        await using var contextB = new JupleDbContext(options);
        var storeA = new LogPurchaseStore(contextA);
        var storeB = new LogPurchaseStore(contextB);

        await storeA.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "A's purchase", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version, DateTimeOffset.UtcNow);

        await Assert.ThrowsAsync<RepeatPurchaseConcurrencyException>(() => storeB.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "B's purchase", new DateOnly(2026, 9, 2)),
            repeatPurchase.Version, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var purchaseCount = await _dbContext.Purchases.CountAsync(p => p.UserId == _userId);
        Assert.Equal(1, purchaseCount);
        var onlyPurchase = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.UserId == _userId);
        Assert.Equal("A's purchase", onlyPurchase.ProductName);
    }

    [Fact]
    public async Task LogAsync_OnDisabledRepeatPurchase_SucceedsAndLeavesIsEnabledFalse()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, isEnabled: false);
        Assert.False(repeatPurchase.IsEnabled);

        var result = await store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Product", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version, DateTimeOffset.UtcNow);

        Assert.True(result.Purchase.Id > 0);
        // Logging a purchase must never silently re-enable tracking/reminders.
        Assert.False(result.RepeatPurchase.IsEnabled);
    }

    [Fact]
    public async Task LogAsync_OnAnotherUsersRepeatPurchase_ThrowsRepeatPurchaseNotFound()
    {
        var store = NewStore();
        var theirs = await CreateRepeatPurchaseAsync(_otherUserId);

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(() => store.LogAsync(
            _userId, theirs.Id, LogFields(null, "Product", new DateOnly(2026, 9, 1)), theirs.Version,
            DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task LogAsync_WhenRepeatPurchaseIsMissing_ThrowsRepeatPurchaseNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(() => store.LogAsync(
            _userId, repeatPurchaseId: -1, LogFields(null, "Product", new DateOnly(2026, 9, 1)),
            [1, 2, 3, 4, 5, 6, 7, 8], DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task LogAsync_WhenRepeatPurchaseItemIdIsAlreadyNull_CreatesPurchaseWithNullItemId()
    {
        var store = NewStore();
        // No race needed here - the Item was already unlinked (deleted earlier, or never set)
        // before this request even started, so the RepeatPurchase row already carries ItemId=null.
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, itemId: null);

        var result = await store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(null, "Repeat Test Product", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version, DateTimeOffset.UtcNow);

        Assert.Null(result.Purchase.ItemId);
    }

    [Fact]
    public async Task LogAsync_WhenItemIsDeletedConcurrentlyDuringTransaction_ThrowsTranslatedExceptionNotRawError()
    {
        var raceItem = new Item(_userId, "https://shop.example/log-purchase-race", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(raceItem);
        await _dbContext.SaveChangesAsync();
        var raceItemId = raceItem.Id;
        _dbContext.ChangeTracker.Clear();

        var seedStore = new RepeatPurchaseStore(_dbContext);
        var repeatPurchase = await seedStore.CreateAsync(
            _userId,
            new RepeatPurchaseFields(
                raceItemId, "Race Product", 30, IntervalUnit.Day, new DateOnly(2026, 9, 30), false, 0),
            DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await using var raceProneContext = CreateContextThatDeletesItemAfterRepeatPurchaseLoad(raceItemId);
        var store = new LogPurchaseStore(raceProneContext);

        // Whichever way the race resolves (RepeatPurchase's RowVersion bumped by the SET NULL
        // cascade, or - if that analysis is ever wrong - a raw FK violation on the Purchase insert),
        // it must surface as one of these two translated exceptions, never a raw DbUpdateException/
        // SqlException, and never a partial write.
        var exception = await Record.ExceptionAsync(() => store.LogAsync(
            _userId, repeatPurchase.Id, LogFields(raceItemId, "Race Product", new DateOnly(2026, 9, 1)),
            repeatPurchase.Version, DateTimeOffset.UtcNow));

        Assert.True(
            exception is RepeatPurchaseConcurrencyException or ItemNotFoundException,
            $"Expected RepeatPurchaseConcurrencyException or ItemNotFoundException, got {exception?.GetType()}");

        _dbContext.ChangeTracker.Clear();
        var purchaseCount = await _dbContext.Purchases.CountAsync(p => p.UserId == _userId);
        Assert.Equal(0, purchaseCount);
    }

    private JupleDbContext CreateContextThatDeletesItemAfterRepeatPurchaseLoad(long itemId)
    {
        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .AddInterceptors(new ConcurrentItemDeleteInterceptor(_connectionString, itemId))
            .Options;
        return new JupleDbContext(options);
    }

    // Mirrors PurchaseStoreIntegrationTests/RepeatPurchaseStoreIntegrationTests' identical
    // interceptor - intercepts LogPurchaseStore's own SELECT against RepeatPurchases and, the first
    // time it completes, deletes the referenced Item for real via an independent connection.
    private sealed class ConcurrentItemDeleteInterceptor(string connectionString, long itemId) : DbCommandInterceptor
    {
        private bool _hasTriggered;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command,
            CommandExecutedEventData eventData,
            DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (!_hasTriggered && command.CommandText.Contains("[purchases].[RepeatPurchases]", StringComparison.Ordinal))
            {
                _hasTriggered = true;

                var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options;
                await using var raceContext = new JupleDbContext(options);
                await raceContext.Database.ExecuteSqlInterpolatedAsync(
                    $"DELETE FROM items.Items WHERE Id = {itemId}", cancellationToken);
            }

            return await base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
        }
    }
}

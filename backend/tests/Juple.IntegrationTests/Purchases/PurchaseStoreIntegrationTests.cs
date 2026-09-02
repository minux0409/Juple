using System.Data.Common;
using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Purchases;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Juple.IntegrationTests.Purchases;

public sealed class PurchaseStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;
    private long _itemId;
    private long _otherUsersItemId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run Purchase store integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/purchase-store-test", DateTimeOffset.UtcNow);
        var othersItem = new Item(_otherUserId, "https://shop.example/purchase-store-test-other", DateTimeOffset.UtcNow);
        _dbContext.Items.AddRange(item, othersItem);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
        _otherUsersItemId = othersItem.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.Purchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private static PurchaseFields Fields(
        long? itemId = null,
        string productName = "Sunscreen",
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
            purchaseDate ?? new DateOnly(2026, 8, 15),
            amount,
            currencyCode,
            store,
            variant,
            quantity,
            memo);

    [Fact]
    public async Task CreateAsync_WithFullFields_PersistsAndReturnsMatchingDto()
    {
        var store = new PurchaseStore(_dbContext);
        var createdAtUtc = DateTimeOffset.UtcNow;

        var created = await store.CreateAsync(
            _userId,
            Fields(_itemId, "선크림 250ml", new DateOnly(2026, 8, 15), 19900.1234m, "krw", "Coupang", "250ml/Blue", 2.5m, "재구매 예정"),
            createdAtUtc);

        Assert.True(created.Id > 0);
        Assert.Equal(_itemId, created.ItemId);
        Assert.Equal("선크림 250ml", created.ProductName);
        Assert.Equal(19900.1234m, created.Amount);
        Assert.Equal("krw", created.CurrencyCode);
        Assert.Equal(createdAtUtc, created.CreatedAtUtc);

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(created, reloaded);
    }

    [Fact]
    public async Task CreateAsync_WithMinimalFields_Succeeds()
    {
        var store = new PurchaseStore(_dbContext);

        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);

        Assert.Null(created.ItemId);
        Assert.Null(created.Amount);
        Assert.Null(created.CurrencyCode);
        Assert.Null(created.Store);
        Assert.Null(created.Variant);
        Assert.Null(created.Quantity);
        Assert.Null(created.Memo);
    }

    [Fact]
    public async Task CreateAsync_WhenItemIdBelongsToAnotherUser_ThrowsItemNotFoundAndCreatesNoRow()
    {
        var store = new PurchaseStore(_dbContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.CreateAsync(_userId, Fields(_otherUsersItemId), DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Empty(page.Purchases);
    }

    [Fact]
    public async Task CreateAsync_WhenItemIdDoesNotExist_ThrowsItemNotFound()
    {
        var store = new PurchaseStore(_dbContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.CreateAsync(_userId, Fields(itemId: -1), DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task GetAsync_WhenOwnedByCurrentUser_ReturnsPurchase()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.GetAsync(_userId, created.Id);

        Assert.NotNull(result);
        Assert.Equal(created.Id, result!.Id);
    }

    [Fact]
    public async Task GetAsync_WhenOwnedByAnotherUser_ReturnsNull()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.GetAsync(_userId, created.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetAsync_WhenPurchaseDoesNotExist_ReturnsNull()
    {
        var store = new PurchaseStore(_dbContext);

        var result = await store.GetAsync(_userId, purchaseId: -1);

        Assert.Null(result);
    }

    [Fact]
    public async Task UpdateAsync_ReplacesEveryEditableField()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(
            _userId, Fields(_itemId, "Old Name", new DateOnly(2026, 8, 1), 100m, "USD", "Old Store"), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UpdateAsync(
            _userId,
            created.Id,
            Fields(null, "New Name", new DateOnly(2026, 8, 20), 200m, "KRW", "New Store", "New Variant", 3m, "New Memo"));
        _dbContext.ChangeTracker.Clear();

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.NotNull(reloaded);
        Assert.Null(reloaded!.ItemId);
        Assert.Equal("New Name", reloaded.ProductName);
        Assert.Equal(new DateOnly(2026, 8, 20), reloaded.PurchaseDate);
        Assert.Equal(200m, reloaded.Amount);
        Assert.Equal("KRW", reloaded.CurrencyCode);
        Assert.Equal("New Store", reloaded.Store);
        Assert.Equal("New Variant", reloaded.Variant);
        Assert.Equal(3m, reloaded.Quantity);
        Assert.Equal("New Memo", reloaded.Memo);
        Assert.Equal(created.CreatedAtUtc, reloaded.CreatedAtUtc);
    }

    [Fact]
    public async Task UpdateAsync_ReassignsItemFromOneOwnedItemToAnother()
    {
        var store = new PurchaseStore(_dbContext);
        var secondItem = new Item(_userId, "https://shop.example/purchase-store-second-item", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(secondItem);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var created = await store.CreateAsync(_userId, Fields(_itemId), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UpdateAsync(_userId, created.Id, Fields(secondItem.Id));
        _dbContext.ChangeTracker.Clear();

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(secondItem.Id, reloaded!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_ClearsItemIdToNull()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_userId, Fields(_itemId), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UpdateAsync(_userId, created.Id, Fields(itemId: null));
        _dbContext.ChangeTracker.Clear();

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Null(reloaded!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_AssignsItemFromNullToAnOwnedItem()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_userId, Fields(itemId: null), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UpdateAsync(_userId, created.Id, Fields(_itemId));
        _dbContext.ChangeTracker.Clear();

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(_itemId, reloaded!.ItemId);
    }

    [Fact]
    public async Task UpdateAsync_WhenPurchaseIsMissing_ThrowsPurchaseNotFound()
    {
        var store = new PurchaseStore(_dbContext);

        await Assert.ThrowsAsync<PurchaseNotFoundException>(
            () => store.UpdateAsync(_userId, purchaseId: -1, Fields()));
    }

    [Fact]
    public async Task UpdateAsync_OnAnotherUsersPurchase_ThrowsPurchaseNotFoundAndLeavesItUnchanged()
    {
        var store = new PurchaseStore(_dbContext);
        var theirs = await store.CreateAsync(_otherUserId, Fields(productName: "Theirs"), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<PurchaseNotFoundException>(
            () => store.UpdateAsync(_userId, theirs.Id, Fields(productName: "Hijacked")));

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.GetAsync(_otherUserId, theirs.Id);
        Assert.Equal("Theirs", reloaded!.ProductName);
    }

    [Fact]
    public async Task UpdateAsync_WhenReassignedItemBelongsToAnotherUser_ThrowsItemNotFoundAndLeavesItUnchanged()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_userId, Fields(_itemId, "Original"), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.UpdateAsync(_userId, created.Id, Fields(_otherUsersItemId, "Hijacked")));

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(_itemId, reloaded!.ItemId);
        Assert.Equal("Original", reloaded.ProductName);
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheRowButLeavesTheItemIntact()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_userId, Fields(_itemId), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, created.Id);
        _dbContext.ChangeTracker.Clear();

        Assert.Null(await store.GetAsync(_userId, created.Id));
        var itemStillExists = await _dbContext.Items.AsNoTracking().AnyAsync(item => item.Id == _itemId);
        Assert.True(itemStillExists);
    }

    [Fact]
    public async Task DeleteAsync_WhenPurchaseDoesNotExist_IsIdempotent()
    {
        var store = new PurchaseStore(_dbContext);

        await store.DeleteAsync(_userId, purchaseId: -1);
    }

    [Fact]
    public async Task DeleteAsync_OnAnotherUsersPurchase_IsANoOpAndLeavesItIntact()
    {
        var store = new PurchaseStore(_dbContext);
        var theirs = await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, theirs.Id);
        _dbContext.ChangeTracker.Clear();

        var stillExists = await store.GetAsync(_otherUserId, theirs.Id);
        Assert.NotNull(stillExists);
    }

    [Fact]
    public async Task ListAsync_OrdersByPurchaseDateDescendingThenIdDescending()
    {
        var store = new PurchaseStore(_dbContext);
        var older = await store.CreateAsync(_userId, Fields(purchaseDate: new DateOnly(2026, 7, 1)), DateTimeOffset.UtcNow);
        var newer = await store.CreateAsync(_userId, Fields(purchaseDate: new DateOnly(2026, 8, 1)), DateTimeOffset.UtcNow);
        var newestSameDayFirst = await store.CreateAsync(
            _userId, Fields(purchaseDate: new DateOnly(2026, 8, 1)), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(
            [newestSameDayFirst.Id, newer.Id, older.Id],
            page.Purchases.Select(p => p.Id));
    }

    [Fact]
    public async Task ListAsync_ExcludesOtherUsersPurchases()
    {
        var store = new PurchaseStore(_dbContext);
        var mine = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Purchases);
        Assert.Equal(mine.Id, page.Purchases[0].Id);
    }

    [Fact]
    public async Task ListAsync_WithLimitLessThanTotal_PagesViaCursorWithoutDuplicateOrMissingRows()
    {
        var store = new PurchaseStore(_dbContext);
        var created = new List<PurchaseDto>();
        for (var day = 1; day <= 5; day++)
        {
            created.Add(await store.CreateAsync(
                _userId, Fields(purchaseDate: new DateOnly(2026, 8, day)), DateTimeOffset.UtcNow));
        }

        _dbContext.ChangeTracker.Clear();

        var expectedOrder = created.OrderByDescending(p => p.PurchaseDate).ThenByDescending(p => p.Id)
            .Select(p => p.Id).ToList();

        var firstPage = await store.ListAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(expectedOrder.Take(2), firstPage.Purchases.Select(p => p.Id));
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(_userId, firstPage.NextCursor, limit: 2);
        Assert.Equal(expectedOrder.Skip(2).Take(2), secondPage.Purchases.Select(p => p.Id));
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.ListAsync(_userId, secondPage.NextCursor, limit: 2);
        Assert.Equal(expectedOrder.Skip(4).Take(2), thirdPage.Purchases.Select(p => p.Id));
        Assert.Null(thirdPage.NextCursor);
    }

    [Fact]
    public async Task ListAsync_WhenFewerRowsThanLimit_ReturnsNullNextCursor()
    {
        var store = new PurchaseStore(_dbContext);
        await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);

        var page = await store.ListAsync(_userId, cursor: null, limit: 50);

        Assert.Null(page.NextCursor);
    }

    // Deterministically reproduces "Item deleted concurrently, between the ownership check and the
    // write" without relying on real thread timing: a DbCommandInterceptor hooks the exact moment
    // the ownership check's SELECT against items.Items finishes, and deletes that Item - for real,
    // via a second JupleDbContext/connection - before control returns to CreateAsync/UpdateAsync.
    // By the time SaveChangesAsync runs, the Item is genuinely gone in the database, so this
    // exercises the real FK violation and PurchaseStore's translation of it, not a simulation.
    [Fact]
    public async Task CreateAsync_WhenItemIsDeletedConcurrentlyAfterOwnershipCheckPasses_ThrowsItemNotFoundNotARawDbError()
    {
        var raceItem = new Item(_userId, "https://shop.example/purchase-race-create", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(raceItem);
        await _dbContext.SaveChangesAsync();
        var raceItemId = raceItem.Id;
        _dbContext.ChangeTracker.Clear();

        await using var raceProneContext = CreateContextThatDeletesItemAfterOwnershipCheck(raceItemId);
        var store = new PurchaseStore(raceProneContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.CreateAsync(_userId, Fields(raceItemId), DateTimeOffset.UtcNow));

        // Final DB invariant: no Purchase row was left referencing the now-deleted Item, and the
        // Item deletion itself went through untouched.
        var itemStillGone = !await _dbContext.Items.AsNoTracking().AnyAsync(item => item.Id == raceItemId);
        Assert.True(itemStillGone);
        var page = await new PurchaseStore(_dbContext).ListAsync(_userId, cursor: null, limit: 50);
        Assert.DoesNotContain(page.Purchases, purchase => purchase.ItemId == raceItemId);
    }

    [Fact]
    public async Task UpdateAsync_WhenReassignedItemIsDeletedConcurrentlyAfterOwnershipCheckPasses_ThrowsItemNotFoundNotARawDbError()
    {
        var store = new PurchaseStore(_dbContext);
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        var raceItem = new Item(_userId, "https://shop.example/purchase-race-update", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(raceItem);
        await _dbContext.SaveChangesAsync();
        var raceItemId = raceItem.Id;
        _dbContext.ChangeTracker.Clear();

        await using var raceProneContext = CreateContextThatDeletesItemAfterOwnershipCheck(raceItemId);
        var raceProneStore = new PurchaseStore(raceProneContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => raceProneStore.UpdateAsync(_userId, created.Id, Fields(raceItemId, "Hijacked")));

        // The Purchase must be left exactly as it was before the failed update - not
        // half-applied, and not referencing the Item that no longer exists.
        var reloaded = await new PurchaseStore(_dbContext).GetAsync(_userId, created.Id);
        Assert.Equal(created, reloaded);
    }

    private JupleDbContext CreateContextThatDeletesItemAfterOwnershipCheck(long itemId)
    {
        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .AddInterceptors(new ConcurrentItemDeleteInterceptor(_connectionString, itemId))
            .Options;
        return new JupleDbContext(options);
    }

    // Test-only seam: intercepts the ownership check's own SELECT against items.Items and, the
    // first time it completes, deletes that Item for real via an independent DbContext/connection -
    // simulating a second request's concurrent Item delete landing in the exact window between the
    // ownership check and the write, without any production-code hook or timing race.
    private sealed class ConcurrentItemDeleteInterceptor(string connectionString, long itemId) : DbCommandInterceptor
    {
        private bool _hasTriggered;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command,
            CommandExecutedEventData eventData,
            DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (!_hasTriggered && command.CommandText.Contains("[items].[Items]", StringComparison.Ordinal))
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

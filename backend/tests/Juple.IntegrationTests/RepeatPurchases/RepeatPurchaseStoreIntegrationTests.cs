using System.Data.Common;
using Juple.Application.Items;
using Juple.Application.RepeatPurchases;
using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.RepeatPurchases;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Juple.IntegrationTests.RepeatPurchases;

public sealed class RepeatPurchaseStoreIntegrationTests : IAsyncLifetime
{
    private const string DefaultProductName = "Repeat Test Product";

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
                "ConnectionStrings__JupleDatabase must be set to run RepeatPurchase store integration " +
                "tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/repeat-purchase-store-test", DateTimeOffset.UtcNow);
        var othersItem = new Item(
            _otherUserId, "https://shop.example/repeat-purchase-store-test-other", DateTimeOffset.UtcNow);
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
            $"DELETE FROM purchases.RepeatPurchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private static RepeatPurchaseFields Fields(
        long? itemId = null,
        string productName = DefaultProductName,
        int intervalValue = 30,
        IntervalUnit intervalUnit = IntervalUnit.Day,
        DateOnly? nextPurchaseDate = null,
        bool isReminderEnabled = false,
        int reminderLeadDays = 0) =>
        new(
            itemId,
            productName,
            intervalValue,
            intervalUnit,
            nextPurchaseDate ?? new DateOnly(2026, 9, 30),
            isReminderEnabled,
            reminderLeadDays);

    private RepeatPurchaseStore NewStore() => new(_dbContext);

    [Fact]
    public async Task CreateAsync_WithFullFields_PersistsAndReturnsMatchingDto()
    {
        var store = NewStore();

        var created = await store.CreateAsync(
            _userId,
            Fields(_itemId, "세럼 30ml", 2, IntervalUnit.Week, new DateOnly(2026, 10, 1), true, 3),
            DateTimeOffset.UtcNow);

        Assert.True(created.Id > 0);
        Assert.Equal(_itemId, created.ItemId);
        Assert.Equal("세럼 30ml", created.ProductName);
        Assert.Equal(2, created.IntervalValue);
        Assert.Equal(IntervalUnit.Week, created.IntervalUnit);
        Assert.Equal(new DateOnly(2026, 10, 1), created.NextPurchaseDate);
        Assert.True(created.IsReminderEnabled);
        Assert.Equal(3, created.ReminderLeadDays);
        Assert.True(created.IsEnabled);
        Assert.NotEmpty(created.Version);
    }

    [Fact]
    public async Task CreateAsync_WithNullItemId_Succeeds()
    {
        var store = NewStore();

        var created = await store.CreateAsync(_userId, Fields(itemId: null, productName: "우산"), DateTimeOffset.UtcNow);

        Assert.Null(created.ItemId);
        Assert.Equal("우산", created.ProductName);
    }

    [Fact]
    public async Task CreateAsync_WhenItemIdBelongsToAnotherUser_ThrowsItemNotFoundAndCreatesNoRow()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.CreateAsync(_userId, Fields(_otherUsersItemId), DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50, itemId: null, includeDisabled: true);
        Assert.Empty(page.RepeatPurchases);
    }

    [Fact]
    public async Task CreateAsync_WhenItemIdDoesNotExist_ThrowsItemNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.CreateAsync(_userId, Fields(itemId: -1), DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task CreateAsync_WhenItemIsDeletedConcurrentlyAfterOwnershipCheckPasses_ThrowsItemNotFoundNotARawDbError()
    {
        var raceItem = new Item(_userId, "https://shop.example/repeat-purchase-race-create", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(raceItem);
        await _dbContext.SaveChangesAsync();
        var raceItemId = raceItem.Id;
        _dbContext.ChangeTracker.Clear();

        await using var raceProneContext = CreateContextThatDeletesItemAfterOwnershipCheck(raceItemId);
        var store = new RepeatPurchaseStore(raceProneContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.CreateAsync(_userId, Fields(raceItemId), DateTimeOffset.UtcNow));

        var itemStillGone = !await _dbContext.Items.AsNoTracking().AnyAsync(item => item.Id == raceItemId);
        Assert.True(itemStillGone);
        var page = await NewStore().ListAsync(_userId, cursor: null, limit: 50, itemId: null, includeDisabled: true);
        Assert.DoesNotContain(page.RepeatPurchases, repeatPurchase => repeatPurchase.ItemId == raceItemId);
    }

    [Fact]
    public async Task GetAsync_WhenOwnedByCurrentUser_ReturnsRepeatPurchase()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.GetAsync(_userId, created.Id);

        Assert.NotNull(result);
        Assert.Equal(created.Id, result!.Id);
    }

    [Fact]
    public async Task GetAsync_WhenOwnedByAnotherUser_ReturnsNull()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.GetAsync(_userId, created.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetAsync_WhenRepeatPurchaseDoesNotExist_ReturnsNull()
    {
        var store = NewStore();

        var result = await store.GetAsync(_userId, repeatPurchaseId: -1);

        Assert.Null(result);
    }

    [Fact]
    public async Task ListAsync_OrdersByNextPurchaseDateAscendingThenIdAscending()
    {
        var store = NewStore();
        var later = await store.CreateAsync(
            _userId, Fields(nextPurchaseDate: new DateOnly(2026, 10, 1)), DateTimeOffset.UtcNow);
        var earlier = await store.CreateAsync(
            _userId, Fields(nextPurchaseDate: new DateOnly(2026, 9, 1)), DateTimeOffset.UtcNow);
        var earliestSameDaySecond = await store.CreateAsync(
            _userId, Fields(nextPurchaseDate: new DateOnly(2026, 9, 1)), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50, itemId: null, includeDisabled: false);

        Assert.Equal(
            [earlier.Id, earliestSameDaySecond.Id, later.Id],
            page.RepeatPurchases.Select(rp => rp.Id));
    }

    [Fact]
    public async Task ListAsync_ExcludesOtherUsersRepeatPurchases()
    {
        var store = NewStore();
        var mine = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50, itemId: null, includeDisabled: true);

        Assert.Single(page.RepeatPurchases);
        Assert.Equal(mine.Id, page.RepeatPurchases[0].Id);
    }

    [Fact]
    public async Task ListAsync_ByDefault_ExcludesDisabled()
    {
        var store = NewStore();
        var enabled = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        var disabled = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        await store.DisableAsync(_userId, disabled.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50, itemId: null, includeDisabled: false);

        Assert.Single(page.RepeatPurchases);
        Assert.Equal(enabled.Id, page.RepeatPurchases[0].Id);
    }

    [Fact]
    public async Task ListAsync_WithIncludeDisabledTrue_IncludesBothEnabledAndDisabled()
    {
        var store = NewStore();
        var enabled = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        var disabled = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        await store.DisableAsync(_userId, disabled.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50, itemId: null, includeDisabled: true);

        Assert.Equal(2, page.RepeatPurchases.Count);
        Assert.Contains(page.RepeatPurchases, rp => rp.Id == enabled.Id);
        Assert.Contains(page.RepeatPurchases, rp => rp.Id == disabled.Id);
    }

    [Fact]
    public async Task ListAsync_WithItemId_ReturnsOnlyThatItemsRepeatPurchases()
    {
        var store = NewStore();
        var secondItem = new Item(_userId, "https://shop.example/repeat-purchase-second-item", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(secondItem);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var forItem = await store.CreateAsync(_userId, Fields(_itemId), DateTimeOffset.UtcNow);
        await store.CreateAsync(_userId, Fields(secondItem.Id), DateTimeOffset.UtcNow);
        await store.CreateAsync(_userId, Fields(itemId: null), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, cursor: null, limit: 50, itemId: _itemId, includeDisabled: true);

        Assert.Single(page.RepeatPurchases);
        Assert.Equal(forItem.Id, page.RepeatPurchases[0].Id);
    }

    [Fact]
    public async Task ListAsync_WithItemIdBelongingToAnotherUser_ThrowsItemNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.ListAsync(
            _userId, cursor: null, limit: 50, itemId: _otherUsersItemId, includeDisabled: false));
    }

    [Fact]
    public async Task ListAsync_WithItemIdThatDoesNotExist_ThrowsItemNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.ListAsync(_userId, cursor: null, limit: 50, itemId: -1, includeDisabled: false));
    }

    [Fact]
    public async Task ListAsync_WithLimitLessThanTotal_PagesViaCursorWithoutDuplicateOrMissingRows()
    {
        var store = NewStore();
        var created = new List<RepeatPurchaseDto>();
        for (var day = 1; day <= 5; day++)
        {
            created.Add(await store.CreateAsync(
                _userId, Fields(nextPurchaseDate: new DateOnly(2026, 9, day)), DateTimeOffset.UtcNow));
        }

        _dbContext.ChangeTracker.Clear();

        var expectedOrder = created.OrderBy(rp => rp.NextPurchaseDate).ThenBy(rp => rp.Id)
            .Select(rp => rp.Id).ToList();

        var firstPage = await store.ListAsync(_userId, cursor: null, limit: 2, itemId: null, includeDisabled: false);
        Assert.Equal(expectedOrder.Take(2), firstPage.RepeatPurchases.Select(rp => rp.Id));
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(
            _userId, firstPage.NextCursor, limit: 2, itemId: null, includeDisabled: false);
        Assert.Equal(expectedOrder.Skip(2).Take(2), secondPage.RepeatPurchases.Select(rp => rp.Id));
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.ListAsync(
            _userId, secondPage.NextCursor, limit: 2, itemId: null, includeDisabled: false);
        Assert.Equal(expectedOrder.Skip(4).Take(2), thirdPage.RepeatPurchases.Select(rp => rp.Id));
        Assert.Null(thirdPage.NextCursor);
    }

    [Fact]
    public async Task UpdateAsync_ReplacesEveryEditableFieldExceptIsEnabled()
    {
        var store = NewStore();
        var created = await store.CreateAsync(
            _userId, Fields(_itemId, "Old Name", 30, IntervalUnit.Day, new DateOnly(2026, 9, 1)),
            DateTimeOffset.UtcNow);
        await store.DisableAsync(_userId, created.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var beforeUpdate = await store.GetAsync(_userId, created.Id);

        var updated = await store.UpdateAsync(
            _userId,
            created.Id,
            Fields(null, "New Name", 2, IntervalUnit.Month, new DateOnly(2026, 12, 1), true, 5),
            beforeUpdate!.Version,
            DateTimeOffset.UtcNow);

        Assert.Null(updated.ItemId);
        Assert.Equal("New Name", updated.ProductName);
        Assert.Equal(2, updated.IntervalValue);
        Assert.Equal(IntervalUnit.Month, updated.IntervalUnit);
        Assert.Equal(new DateOnly(2026, 12, 1), updated.NextPurchaseDate);
        Assert.True(updated.IsReminderEnabled);
        Assert.Equal(5, updated.ReminderLeadDays);
        // Update() never touches IsEnabled - only Enable/Disable do (see RepeatPurchase.Update).
        Assert.False(updated.IsEnabled);
    }

    [Fact]
    public async Task UpdateAsync_OnSuccess_ReturnsNewVersionDifferentFromOriginal()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var updated = await store.UpdateAsync(
            _userId, created.Id, Fields(productName: "Updated"), created.Version, DateTimeOffset.UtcNow);

        Assert.NotEqual(created.Version, updated.Version);
    }

    [Fact]
    public async Task UpdateAsync_WithStaleVersion_ThrowsRepeatPurchaseConcurrencyExceptionAndLeavesRowUnchanged()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(productName: "Original"), DateTimeOffset.UtcNow);
        var staleVersion = created.Version;
        _dbContext.ChangeTracker.Clear();

        // Someone else's update lands first, advancing the RowVersion past what this caller read.
        await store.UpdateAsync(
            _userId, created.Id, Fields(productName: "Someone else's edit"), staleVersion, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<RepeatPurchaseConcurrencyException>(() => store.UpdateAsync(
            _userId, created.Id, Fields(productName: "My stale edit"), staleVersion, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal("Someone else's edit", reloaded!.ProductName);
    }

    [Fact]
    public async Task UpdateAsync_ConcurrentUpdateFromTwoIndependentContexts_SecondAttemptConflicts()
    {
        var seedStore = NewStore();
        var created = await seedStore.CreateAsync(_userId, Fields(productName: "Original"), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        // Two independent DbContexts (two separate "requests") both read the same row before
        // either writes - a genuine concurrent-edit simulation, not just a reused stale byte[].
        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        await using var contextA = new JupleDbContext(options);
        await using var contextB = new JupleDbContext(options);
        var storeA = new RepeatPurchaseStore(contextA);
        var storeB = new RepeatPurchaseStore(contextB);

        var readByA = await storeA.GetAsync(_userId, created.Id);
        var readByB = await storeB.GetAsync(_userId, created.Id);

        await storeA.UpdateAsync(
            _userId, created.Id, Fields(productName: "A's edit"), readByA!.Version, DateTimeOffset.UtcNow);

        await Assert.ThrowsAsync<RepeatPurchaseConcurrencyException>(() => storeB.UpdateAsync(
            _userId, created.Id, Fields(productName: "B's edit"), readByB!.Version, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task UpdateAsync_WhenRepeatPurchaseIsMissing_ThrowsRepeatPurchaseNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(() => store.UpdateAsync(
            _userId, repeatPurchaseId: -1, Fields(), [1, 2, 3, 4, 5, 6, 7, 8], DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task UpdateAsync_OnAnotherUsersRepeatPurchase_ThrowsRepeatPurchaseNotFoundAndLeavesItUnchanged()
    {
        var store = NewStore();
        var theirs = await store.CreateAsync(_otherUserId, Fields(productName: "Theirs"), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(() => store.UpdateAsync(
            _userId, theirs.Id, Fields(productName: "Hijacked"), theirs.Version, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.GetAsync(_otherUserId, theirs.Id);
        Assert.Equal("Theirs", reloaded!.ProductName);
    }

    [Fact]
    public async Task UpdateAsync_WhenReassignedItemBelongsToAnotherUser_ThrowsItemNotFoundAndLeavesItUnchanged()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(_itemId, "Original"), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.UpdateAsync(
            _userId, created.Id, Fields(_otherUsersItemId, "Hijacked"), created.Version, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(_itemId, reloaded!.ItemId);
        Assert.Equal("Original", reloaded.ProductName);
    }

    [Fact]
    public async Task EnableAsync_TogglesIsEnabledAndUpdatesTimestampAndVersion()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        var afterDisable = await store.DisableAsync(_userId, created.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var updatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(5);

        var enabled = await store.EnableAsync(_userId, created.Id, updatedAtUtc);
        _dbContext.ChangeTracker.Clear();

        Assert.True(enabled.IsEnabled);
        Assert.Equal(updatedAtUtc, enabled.UpdatedAtUtc);
        // A real state change must produce a new RowVersion - the response is never left holding
        // a version that went stale the instant this same call committed.
        Assert.NotEqual(afterDisable.Version, enabled.Version);

        // The returned DTO must match what a fresh read of the row actually says - the response is
        // not just an in-memory guess at the post-transition state.
        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(reloaded!.Version, enabled.Version);
        Assert.True(reloaded.IsEnabled);
        Assert.Equal(updatedAtUtc, reloaded.UpdatedAtUtc);
    }

    [Fact]
    public async Task EnableAsync_WhenAlreadyEnabled_IsIdempotentNoOpAndVersionUnchanged()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        // Already enabled at creation - calling Enable again must not throw, alter UpdatedAtUtc,
        // or bump RowVersion (no actual UPDATE statement should even run).
        var enabled = await store.EnableAsync(_userId, created.Id, DateTimeOffset.UtcNow.AddMinutes(5));
        _dbContext.ChangeTracker.Clear();

        Assert.True(enabled.IsEnabled);
        Assert.Equal(created.UpdatedAtUtc, enabled.UpdatedAtUtc);
        Assert.Equal(created.Version, enabled.Version);

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(reloaded!.Version, enabled.Version);
    }

    [Fact]
    public async Task DisableAsync_TogglesIsEnabledAndUpdatesTimestampAndVersion()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var updatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(5);

        var disabled = await store.DisableAsync(_userId, created.Id, updatedAtUtc);
        _dbContext.ChangeTracker.Clear();

        Assert.False(disabled.IsEnabled);
        Assert.Equal(updatedAtUtc, disabled.UpdatedAtUtc);
        Assert.NotEqual(created.Version, disabled.Version);

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(reloaded!.Version, disabled.Version);
        Assert.False(reloaded.IsEnabled);
        Assert.Equal(updatedAtUtc, reloaded.UpdatedAtUtc);
    }

    [Fact]
    public async Task DisableAsync_WhenAlreadyDisabled_IsIdempotentNoOpAndVersionUnchanged()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(), DateTimeOffset.UtcNow);
        var afterFirstDisable = await store.DisableAsync(_userId, created.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var disabledAgain = await store.DisableAsync(_userId, created.Id, DateTimeOffset.UtcNow.AddMinutes(5));
        _dbContext.ChangeTracker.Clear();

        Assert.False(disabledAgain.IsEnabled);
        Assert.Equal(afterFirstDisable.UpdatedAtUtc, disabledAgain.UpdatedAtUtc);
        Assert.Equal(afterFirstDisable.Version, disabledAgain.Version);

        var reloaded = await store.GetAsync(_userId, created.Id);
        Assert.Equal(reloaded!.Version, disabledAgain.Version);
    }

    [Fact]
    public async Task EnableAsync_WhenRepeatPurchaseIsMissing_ThrowsRepeatPurchaseNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(
            () => store.EnableAsync(_userId, repeatPurchaseId: -1, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task DisableAsync_OnAnotherUsersRepeatPurchase_ThrowsRepeatPurchaseNotFound()
    {
        var store = NewStore();
        var theirs = await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<RepeatPurchaseNotFoundException>(
            () => store.DisableAsync(_userId, theirs.Id, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheRowButLeavesLinkedPurchaseIntactWithRepeatPurchaseIdSetNull()
    {
        var store = NewStore();
        var created = await store.CreateAsync(_userId, Fields(_itemId), DateTimeOffset.UtcNow);

        var purchase = new Purchase(
            _userId, _itemId, new DateOnly(2026, 9, 1), "Logged Purchase", null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.Entry(purchase).Property(p => p.RepeatPurchaseId).CurrentValue = created.Id;
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, created.Id);
        _dbContext.ChangeTracker.Clear();

        Assert.Null(await store.GetAsync(_userId, created.Id));
        var reloadedPurchase = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);
        Assert.Null(reloadedPurchase.RepeatPurchaseId);
    }

    [Fact]
    public async Task DeleteAsync_WhenRepeatPurchaseDoesNotExist_IsIdempotent()
    {
        var store = NewStore();

        await store.DeleteAsync(_userId, repeatPurchaseId: -1);
    }

    [Fact]
    public async Task DeleteAsync_OnAnotherUsersRepeatPurchase_IsANoOpAndLeavesItIntact()
    {
        var store = NewStore();
        var theirs = await store.CreateAsync(_otherUserId, Fields(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, theirs.Id);
        _dbContext.ChangeTracker.Clear();

        var stillExists = await store.GetAsync(_otherUserId, theirs.Id);
        Assert.NotNull(stillExists);
    }

    [Fact]
    public void IndexModel_UserIdIsEnabledNextPurchaseDateId_ExistsForUpcomingScheduleQueries()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(RepeatPurchase))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "IX_RepeatPurchases_UserId_IsEnabled_NextPurchaseDate_Id");

        Assert.NotNull(index);
        Assert.Equal(
            new[] { "UserId", "IsEnabled", "NextPurchaseDate", "Id" },
            index!.Properties.Select(p => p.Name));
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
    // ownership check and the write. Mirrors PurchaseStoreIntegrationTests' identical interceptor.
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

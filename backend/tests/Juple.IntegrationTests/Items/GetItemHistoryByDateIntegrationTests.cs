using Juple.Application.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class GetItemHistoryByDateIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item history-by-date query " +
                "integration tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task GetByDateRangeAsync_ExcludesOtherUsersItems()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var myItem = await SaveAsync(store, "https://shop.example/history-date-ownership-mine", fromUtc.AddHours(1));
        await store.SaveAsync(
            _otherUserId, "https://shop.example/history-date-ownership-other", null, fromUtc.AddHours(1));
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(myItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByDateRangeAsync_IncludesItemsRegardlessOfCurrentState()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var inboxItem = await SaveAsync(store, "https://shop.example/history-date-state-inbox", fromUtc.AddHours(1));
        var wishlistItem = await SaveAsync(
            store, "https://shop.example/history-date-state-wishlist", fromUtc.AddHours(2));
        var archivedItem = await SaveAsync(
            store, "https://shop.example/history-date-state-archived", fromUtc.AddHours(3));

        await store.MoveToWishlistAsync(_userId, wishlistItem, DateTimeOffset.UtcNow);
        await store.MoveToArchiveAsync(_userId, archivedItem, DateTimeOffset.UtcNow);

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        var returnedIds = page.Items.Select(item => item.Id).ToList();
        Assert.Contains(inboxItem, returnedIds);
        Assert.Contains(wishlistItem, returnedIds);
        Assert.Contains(archivedItem, returnedIds);
    }

    [Fact]
    public async Task GetByDateRangeAsync_ExcludesDeletedItems()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var keptItem = await SaveAsync(store, "https://shop.example/history-date-delete-kept", fromUtc.AddHours(1));
        var deletedItem = await SaveAsync(
            store, "https://shop.example/history-date-delete-removed", fromUtc.AddHours(2));

        await store.DeleteAsync(_userId, deletedItem);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(keptItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByDateRangeAsync_OrdersBySavedAtUtcDescendingThenIdDescending()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var first = await store.SaveAsync(
            _userId, "https://shop.example/history-date-sort-1", null, fromUtc.AddHours(1));
        _dbContext.ChangeTracker.Clear();
        var second = await store.SaveAsync(
            _userId, "https://shop.example/history-date-sort-2", null, fromUtc.AddHours(2));
        _dbContext.ChangeTracker.Clear();
        var third = await store.SaveAsync(
            _userId, "https://shop.example/history-date-sort-3", null, fromUtc.AddHours(3));
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Equal(
            new[] { third.Entry.Id, second.Entry.Id, first.Entry.Id },
            page.Items.Select(item => item.Id));
    }

    [Fact]
    public async Task GetByDateRangeAsync_SavedExactlyAtFromUtc_IsIncluded()
    {
        // The range is [fromUtc, toUtc) - a save landing exactly on the lower boundary (e.g. a
        // save at local midnight) must still count as that local day.
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var boundaryItem = await SaveAsync(store, "https://shop.example/history-date-boundary-from", fromUtc);

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(boundaryItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByDateRangeAsync_SavedOneSecondBeforeToUtc_IsIncluded()
    {
        // [fromUtc, toUtc) is half-open at the top - the last representable instant strictly
        // before toUtc still belongs to this local day and must be included. A 1-second offset
        // (rather than a sub-tick offset that could round away under datetimeoffset column
        // precision) keeps this unambiguous regardless of the underlying SQL Server precision.
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var boundaryItem = await SaveAsync(
            store, "https://shop.example/history-date-boundary-just-before-to", toUtc.AddSeconds(-1));

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(boundaryItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByDateRangeAsync_SavedExactlyAtToUtc_IsExcluded()
    {
        // toUtc is the exclusive start of the next local day - a save landing exactly on it
        // belongs to the following day, not this one.
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        await SaveAsync(store, "https://shop.example/history-date-boundary-to", toUtc);

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task GetByDateRangeAsync_SavedOneSecondAfterToUtc_IsExcluded()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        await SaveAsync(store, "https://shop.example/history-date-boundary-after-to", toUtc.AddSeconds(1));

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task GetByDateRangeAsync_SavedJustBeforeFromUtc_IsExcluded()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        await SaveAsync(
            store, "https://shop.example/history-date-boundary-before", fromUtc.AddMilliseconds(-1));

        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);

        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task GetByDateRangeAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var result = await store.SaveAsync(
                _userId, $"https://shop.example/history-date-paging-{i}", null, fromUtc.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            ids.Add(result.Entry.Id);
        }

        var (firstPage, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _) = await store.GetByDateRangeAsync(
            _userId, fromUtc, toUtc, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var (thirdPage, _) = await store.GetByDateRangeAsync(
            _userId, fromUtc, toUtc, cursor: secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(item => item.Id)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetByDateRangeAsync_WhenSavedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);
        var sameTime = fromUtc.AddHours(12);
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var result = await store.SaveAsync(_userId, $"https://shop.example/history-date-tie-{i}", null, sameTime);
            _dbContext.ChangeTracker.Clear();
            ids.Add(result.Entry.Id);
        }

        var (firstPage, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _) = await store.GetByDateRangeAsync(
            _userId, fromUtc, toUtc, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(item => item.Id).ToList();
        Assert.Equal(4, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetByDateRangeAsync_CursorFromAdjacentDay_DoesNotLeakItemsAcrossDateRange()
    {
        // The cursor is a pure (SavedAtUtc, Id) keyset position with no date-awareness of its own -
        // the [fromUtc, toUtc) predicate must still be enforced even when resuming from a cursor,
        // so a cursor cannot be used to page into a different day's Items.
        var store = new ItemStore(_dbContext);
        var fromUtc = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);
        var toUtc = fromUtc.AddDays(1);

        var todayItem = await SaveAsync(store, "https://shop.example/history-date-cursor-today", fromUtc.AddHours(1));
        var (page, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor: null, limit: 50);
        Assert.Single(page.Items);
        Assert.Equal(todayItem, page.Items[0].Id);

        var cursor = new ItemHistoryPageCursor(page.Items[0].SavedAtUtc, page.Items[0].Id);
        var (resumedPage, _) = await store.GetByDateRangeAsync(_userId, fromUtc, toUtc, cursor, limit: 50);

        Assert.Empty(resumedPage.Items);
        Assert.Null(resumedPage.NextCursor);
    }

    private async Task<long> SaveAsync(ItemStore store, string url, DateTimeOffset savedAtUtc)
    {
        var result = await store.SaveAsync(_userId, url, null, savedAtUtc);
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }
}

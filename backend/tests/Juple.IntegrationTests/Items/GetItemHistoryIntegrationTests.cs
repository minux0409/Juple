using Juple.Application.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class GetItemHistoryIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item history query integration tests " +
                "against a local SQL Server instance.");

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
    public async Task GetHistoryAsync_ExcludesOtherUsersItems()
    {
        var store = new ItemStore(_dbContext);
        var myItem = await SaveAsync(store, "https://shop.example/history-ownership-mine");
        await store.SaveAsync(_otherUserId, "https://shop.example/history-ownership-other", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(myItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetHistoryAsync_ExcludesDeletedItems()
    {
        var store = new ItemStore(_dbContext);
        var keptItem = await SaveAsync(store, "https://shop.example/history-delete-kept");
        var deletedItem = await SaveAsync(store, "https://shop.example/history-delete-removed");

        await store.DeleteAsync(_userId, deletedItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(keptItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetHistoryAsync_OrdersBySavedAtUtcDescendingThenIdDescending()
    {
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;

        var first = await store.SaveAsync(_userId, "https://shop.example/history-sort-1", null, baseTime);
        _dbContext.ChangeTracker.Clear();
        var second = await store.SaveAsync(
            _userId, "https://shop.example/history-sort-2", null, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();
        var third = await store.SaveAsync(
            _userId, "https://shop.example/history-sort-3", null, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(
            new[] { third.Entry.Id, second.Entry.Id, first.Entry.Id },
            page.Items.Select(item => item.Id));
    }

    [Fact]
    public async Task GetHistoryAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var result = await store.SaveAsync(
                _userId, $"https://shop.example/history-paging-{i}", null, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            ids.Add(result.Entry.Id);
        }

        var (firstPage, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _, _) = await store.GetHistoryAsync(_userId, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var (thirdPage, _, _) = await store.GetHistoryAsync(_userId, cursor: secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(item => item.Id)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetHistoryAsync_WhenSavedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var sameTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var result = await store.SaveAsync(_userId, $"https://shop.example/history-tie-{i}", null, sameTime);
            _dbContext.ChangeTracker.Clear();
            ids.Add(result.Entry.Id);
        }

        var (firstPage, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _, _) = await store.GetHistoryAsync(_userId, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(item => item.Id).ToList();
        Assert.Equal(4, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    // ---------- Archive search (history?q=) ----------

    private async Task<long> SaveWithDetailsAsync(ItemStore store, string url, string? title, string? memo, DateTimeOffset? savedAt = null)
    {
        var result = await store.SaveAsync(_userId, url, null, savedAt ?? DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var item = await _dbContext.Items.SingleAsync(entry => entry.Id == result.Entry.Id);
        item.UpdateDetails(title, memo);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }

    private async Task<IReadOnlyList<long>> SearchAsync(ItemStore store, string term, long? userId = null, ItemHistoryPageCursor? cursor = null, int limit = 50) =>
        (await store.GetHistoryAsync(userId ?? _userId, cursor, limit, ItemSearchPattern.ToContainsPattern(term))).Page.Items.Select(item => item.Id).ToList();

    [Fact]
    public async Task Search_MatchesTitle_LinkHost_AndOwnMemo_NewestFirst_OwnItemsOnly()
    {
        var store = new ItemStore(_dbContext);
        var now = DateTimeOffset.UtcNow;
        var byTitle = await SaveWithDetailsAsync(store, "https://a.example/1", "Quokka travel guide", null, now.AddMinutes(-3));
        var byHost = await SaveWithDetailsAsync(store, "https://quokka.example/2", null, null, now.AddMinutes(-2));
        var byMemo = await SaveWithDetailsAsync(store, "https://c.example/3", null, "ask about QUOKKA tickets", now.AddMinutes(-1));
        await SaveWithDetailsAsync(store, "https://d.example/4", "Something else", "unrelated");
        await store.SaveAsync(_otherUserId, "https://quokka.example/other-user", null, now);
        _dbContext.ChangeTracker.Clear();

        // Case-insensitive (the column collation), newest saved first, never another user's link.
        Assert.Equal([byMemo, byHost, byTitle], await SearchAsync(store, "quokka"));
        Assert.Empty(await SearchAsync(store, "no-such-term"));
    }

    [Fact]
    public async Task Search_NeverReturnsTrashedItems()
    {
        var store = new ItemStore(_dbContext);
        var kept = await SaveWithDetailsAsync(store, "https://kept.example/", "Pangolin notes", null);
        var deleted = await SaveWithDetailsAsync(store, "https://gone.example/", "Pangolin trash", null);
        await store.DeleteAsync(_userId, deleted, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal([kept], await SearchAsync(store, "pangolin"));
    }

    [Fact]
    public async Task Search_TreatsWildcardsAsLiteralText()
    {
        var store = new ItemStore(_dbContext);
        var percent = await SaveWithDetailsAsync(store, "https://p.example/", "100% sure", null);
        await SaveWithDetailsAsync(store, "https://q.example/", "1000 sure", null);
        var underscore = await SaveWithDetailsAsync(store, "https://u.example/", "snake_case", null);
        await SaveWithDetailsAsync(store, "https://v.example/", "snakeXcase", null);
        var bracket = await SaveWithDetailsAsync(store, "https://b.example/", "[draft] plan", null);
        await SaveWithDetailsAsync(store, "https://w.example/", "d plan", null);

        Assert.Equal([percent], await SearchAsync(store, "0% s"));
        Assert.Equal([underscore], await SearchAsync(store, "e_c"));
        Assert.Equal([bracket], await SearchAsync(store, "[draft]"));
        Assert.Empty(await SearchAsync(store, "\\"));
    }

    [Fact]
    public async Task Search_PagesWithTheSameKeysetCursorAsHistory()
    {
        var store = new ItemStore(_dbContext);
        var time = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            ids.Add(await SaveWithDetailsAsync(store, $"https://page.example/{i}", $"Marmot {i}", null, time.AddMinutes(i)));
        }

        var (first, _, _) = await store.GetHistoryAsync(_userId, null, 2, ItemSearchPattern.ToContainsPattern("marmot"));
        Assert.Equal(2, first.Items.Count);
        Assert.NotNull(first.NextCursor);
        var (second, _, _) = await store.GetHistoryAsync(_userId, first.NextCursor, 2, ItemSearchPattern.ToContainsPattern("marmot"));
        var (third, _, _) = await store.GetHistoryAsync(_userId, second.NextCursor, 2, ItemSearchPattern.ToContainsPattern("marmot"));
        Assert.Null(third.NextCursor);
        Assert.Equal(ids.AsEnumerable().Reverse(), first.Items.Concat(second.Items).Concat(third.Items).Select(item => item.Id));
    }

    [Fact]
    public void SearchTerm_IsTrimmedAndBounded()
    {
        Assert.Null(ItemSearchPattern.Normalize(null));
        Assert.Null(ItemSearchPattern.Normalize("   "));
        Assert.Null(ItemSearchPattern.Normalize(" a "));
        Assert.Equal("ab", ItemSearchPattern.Normalize(" ab "));
        Assert.Null(ItemSearchPattern.Normalize(new string('x', ItemSearchPattern.MaxLength + 1)));
        Assert.Equal("%a\\%b\\_c\\[d\\\\e%", ItemSearchPattern.ToContainsPattern("a%b_c[d\\e"));
    }

    private async Task<long> SaveAsync(ItemStore store, string url)
    {
        var result = await store.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }
}

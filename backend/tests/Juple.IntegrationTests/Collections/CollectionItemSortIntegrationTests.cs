using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// 일자순 over a whole Collection larger than one page: the server orders every link by AddedAtUtc
/// (ties by ItemId) and pages through that order with its own cursor, so the first link of 오래된순
/// is the oldest in the Collection - not the oldest of whatever page happened to be loaded.
/// </summary>
public sealed class CollectionItemSortIntegrationTests : IAsyncLifetime
{
    private const int LinkCount = 120;
    // Five links share one timestamp, straddling the 50-link page boundary of the date orders.
    private const int TieStart = 68;
    private const int TieCount = 5;

    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private long _owner;
    private long _collectionId;
    private readonly DateTimeOffset _base = new(2025, 3, 1, 9, 0, 0, TimeSpan.Zero);
    private readonly List<(long ItemId, DateTimeOffset AddedAtUtc, int SortOrder)> _links = [];

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _collections = new CollectionStore(_db);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _owner = user.Id;
        _collectionId = (await _collections.CreateAsync(_owner, "Big", "BIG", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

        var itemStore = new ItemStore(_db);
        for (var index = 0; index < LinkCount; index++)
        {
            var saved = await itemStore.SaveAsync(_owner, $"https://example.test/sort/{index}", null, DateTimeOffset.UtcNow);
            // Each link a day apart (months apart overall), except the tie group; the manual
            // SortOrder is deliberately scrambled so it never coincides with either date order.
            var addedAtUtc = index is >= TieStart and < TieStart + TieCount
                ? _base.AddDays(TieStart)
                : _base.AddDays(index);
            var sortOrder = (index * 37 % LinkCount) * 10;
            _db.CollectionItems.Add(new CollectionItem(_collectionId, saved.Entry.Id, _owner, addedAtUtc, sortOrder));
            _links.Add((saved.Entry.Id, addedAtUtc, sortOrder));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        await new AccountDeletionStore(_db).DeleteAllDataAsync(_owner, $"test/{_owner}/", DateTimeOffset.UtcNow);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task DateDesc_StartsWithTheNewestOfTheWholeCollection_AndPagesThroughEveryLinkOnce()
    {
        var expected = _links.OrderByDescending(link => link.AddedAtUtc).ThenByDescending(link => link.ItemId).Select(link => link.ItemId).ToList();

        var (firstPage, _, _) = await _collections.GetItemsAsync(_owner, _collectionId, null, 50, CollectionItemSort.DateDesc);
        Assert.Equal(expected[0], firstPage.Items[0].ItemId);
        Assert.Equal(_base.AddDays(LinkCount - 1), firstPage.Items[0].AddedAtUtc);

        Assert.Equal(expected, await ReadAllAsync(CollectionItemSort.DateDesc, 50));
    }

    [Fact]
    public async Task DateAsc_StartsWithTheOldestOfTheWholeCollection_EvenThoughItIsNotOnTheNewestFirstPage()
    {
        var expected = _links.OrderBy(link => link.AddedAtUtc).ThenBy(link => link.ItemId).Select(link => link.ItemId).ToList();
        var (newestFirstPage, _, _) = await _collections.GetItemsAsync(_owner, _collectionId, null, 50, CollectionItemSort.DateDesc);
        Assert.DoesNotContain(newestFirstPage.Items, item => item.ItemId == expected[0]);

        var (firstPage, _, _) = await _collections.GetItemsAsync(_owner, _collectionId, null, 50, CollectionItemSort.DateAsc);
        Assert.Equal(expected[0], firstPage.Items[0].ItemId);
        Assert.Equal(_base, firstPage.Items[0].AddedAtUtc);

        Assert.Equal(expected, await ReadAllAsync(CollectionItemSort.DateAsc, 50));
    }

    [Theory]
    [InlineData(CollectionItemSort.DateDesc)]
    [InlineData(CollectionItemSort.DateAsc)]
    public async Task EqualTimestamps_PageInItemIdOrder_WithNoDuplicateOrGap_AcrossEveryPageBoundary(CollectionItemSort sort)
    {
        // Small pages put several boundaries inside the tie group.
        var all = await ReadAllAsync(sort, 3);

        Assert.Equal(LinkCount, all.Count);
        Assert.Equal(LinkCount, all.Distinct().Count());
        var tie = _links.Where(link => link.AddedAtUtc == _base.AddDays(TieStart)).Select(link => link.ItemId).ToList();
        var tieInOrder = all.Where(tie.Contains).ToList();
        Assert.Equal(sort == CollectionItemSort.DateAsc ? tie.Order().ToList() : tie.OrderDescending().ToList(), tieInOrder);
    }

    [Fact]
    public async Task WithoutSort_TheOriginalManualOrderIsUnchanged()
    {
        var expected = _links.OrderBy(link => link.SortOrder).ThenBy(link => link.ItemId).Select(link => link.ItemId).ToList();

        Assert.Equal(expected, await ReadAllAsync(CollectionItemSort.Manual, 50));
    }

    [Fact]
    public async Task ACursorFromOneOrder_IsRefusedByAnother()
    {
        var (page, _, _) = await _collections.GetItemsAsync(_owner, _collectionId, null, 50, CollectionItemSort.DateDesc);

        await Assert.ThrowsAsync<ArgumentException>(() =>
            _collections.GetItemsAsync(_owner, _collectionId, page.NextCursor, 50, CollectionItemSort.DateAsc));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _collections.GetItemsAsync(_owner, _collectionId, page.NextCursor, 50, CollectionItemSort.Manual));
    }

    /// <summary>Every page of one order, each next cursor passed over the wire codec exactly as a client would.</summary>
    private async Task<List<long>> ReadAllAsync(CollectionItemSort sort, int limit)
    {
        var ids = new List<long>();
        CollectionItemPageCursor? cursor = null;
        for (var guard = 0; guard < 200; guard++)
        {
            var (page, _, _) = await _collections.GetItemsAsync(_owner, _collectionId, cursor, limit, sort);
            ids.AddRange(page.Items.Select(item => item.ItemId));
            if (page.NextCursor is null)
            {
                return ids;
            }

            Assert.True(CollectionItemPageCursorCodec.TryDecode(CollectionItemPageCursorCodec.Encode(page.NextCursor), out cursor));
            Assert.Equal(sort, cursor!.Sort);
        }

        throw new InvalidOperationException("Paging never ended.");
    }
}

using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// GET history?sort=name over the WHOLE archive: titled links by title, title-less ones by site, and links still behind a
/// Collection lock in a last bucket with no key - keyset-paged, with the same ties as the app (newest saved first).
/// </summary>
public sealed class HistoryNameSortIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private long _userId;
    private long _otherUserId;
    private static readonly DateTimeOffset Base = new(2026, 3, 1, 12, 0, 0, TimeSpan.Zero);

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();
        var now = DateTimeOffset.UtcNow;
        var user = new User("en-US", "UTC", null, now, now);
        var other = new User("en-US", "UTC", null, now, now);
        _db.Users.AddRange(user, other);
        await _db.SaveChangesAsync();
        (_userId, _otherUserId) = (user.Id, other.Id);
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _userId, _otherUserId })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<long> AddItemAsync(long userId, string url, string? title, int minutesAfterBase, string? memo = null)
    {
        var item = new Item(userId, url, Base.AddMinutes(minutesAfterBase));
        if (title is not null)
        {
            item.UpdateDetails(title, memo);
        }

        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        return item.Id;
    }

    private async Task<Collection> AddCollectionAsync(long ownerId, bool locked)
    {
        var collection = new Collection(ownerId, locked ? "Private" : "Open", "PRIVATE", CollectionIcon.Folder, Base);
        if (locked)
        {
            collection.Lock(Base);
        }

        _db.Collections.Add(collection);
        await _db.SaveChangesAsync();
        return collection;
    }

    private async Task LinkAsync(long collectionId, long itemId, long addedByUserId)
    {
        _db.CollectionItems.Add(new CollectionItem(collectionId, itemId, addedByUserId, Base, 0));
        await _db.SaveChangesAsync();
    }

    private async Task<List<ItemHistoryEntryDto>> ReadAllAsync(int pageSize, string? searchPattern = null, long? userId = null)
    {
        var all = new List<ItemHistoryEntryDto>();
        ItemHistoryPageCursor? cursor = null;
        var guard = 0;
        do
        {
            var (page, _, _) = await new ItemStore(NewContext()).GetHistoryAsync(userId ?? _userId, cursor, pageSize, searchPattern, ItemHistorySort.Name);
            Assert.True(page.Items.Count <= pageSize);
            all.AddRange(page.Items);
            cursor = page.NextCursor;
        }
        while (cursor is not null && ++guard < 100);
        return all;
    }

    private static string[] Names(IEnumerable<ItemHistoryEntryDto> items) => items.Select(item => item.Title ?? new Uri(item.Url).Host).ToArray();

    [Fact]
    public async Task NameOrder_IsTitledLinksByTitle_ThenTitleLessBySiteHost_WholeArchive()
    {
        await AddItemAsync(_userId, "https://x.example/1", "cherry", 1);
        await AddItemAsync(_userId, "https://x.example/2", "Apple", 2);
        await AddItemAsync(_userId, "https://x.example/3", "banana", 3);
        await AddItemAsync(_userId, "https://zeta.example/page", null, 4);
        await AddItemAsync(_userId, "https://www.alpha.example/page?x=1", null, 5);
        await AddItemAsync(_userId, "http://beta.example", null, 6);

        var all = await ReadAllAsync(50);

        // Titled first (case-insensitive collation), then title-less by host with a leading www. ignored.
        Assert.Equal(["Apple", "banana", "cherry", "www.alpha.example", "beta.example", "zeta.example"], Names(all));
    }

    [Fact]
    public async Task NameOrder_PagesWithoutGapsOrRepeats_AcrossManyPages()
    {
        var expected = new List<string>();
        for (var index = 0; index < 23; index++)
        {
            var title = $"Title {index:000}";
            expected.Add(title);
            await AddItemAsync(_userId, $"https://x.example/{index}", title, index);
        }

        var ids = new List<long>();
        ItemHistoryPageCursor? cursor = null;
        var pages = 0;
        do
        {
            var (page, _, _) = await new ItemStore(NewContext()).GetHistoryAsync(_userId, cursor, 5, null, ItemHistorySort.Name);
            ids.AddRange(page.Items.Select(item => item.Id));
            cursor = page.NextCursor;
            pages++;
        }
        while (cursor is not null && pages < 50);

        Assert.Equal(5, pages);
        Assert.Equal(23, ids.Count);
        Assert.Equal(23, ids.Distinct().Count());
        var all = await ReadAllAsync(7);
        Assert.Equal(expected, Names(all));
    }

    [Fact]
    public async Task NameOrder_SameTitle_IsNewestSavedFirst_AndStableAcrossAPageBoundary()
    {
        var oldest = await AddItemAsync(_userId, "https://x.example/a", "Same", 1);
        var middle = await AddItemAsync(_userId, "https://x.example/b", "Same", 2);
        var newest = await AddItemAsync(_userId, "https://x.example/c", "Same", 3);
        await AddItemAsync(_userId, "https://x.example/d", "Zzz", 4);

        // One item per page forces every tie across a boundary.
        var paged = await ReadAllAsync(1);
        Assert.Equal([newest, middle, oldest], paged.Take(3).Select(item => item.Id));
        Assert.Equal(paged.Select(item => item.Id), (await ReadAllAsync(50)).Select(item => item.Id));
    }

    [Fact]
    public async Task NameOrder_BlankTitleCountsAsTitleLess_AndIsDeterministic()
    {
        await AddItemAsync(_userId, "https://x.example/1", "Real", 1);
        var blank = await AddItemAsync(_userId, "https://blank.example/p", "placeholder", 2);
        await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE items.Items SET Title = N'   ' WHERE Id = {blank}");
        await AddItemAsync(_userId, "https://none.example/p", null, 3);

        var all = await ReadAllAsync(1);

        Assert.Equal(blank, all[1].Id);
        Assert.Equal(["Real", "blank.example", "none.example"], all.Select(item => item.Id == blank ? "blank.example" : item.Title ?? new Uri(item.Url).Host).ToArray());
    }

    [Fact]
    public async Task NameOrder_WithSearch_IsTheMatchesInNameOrder()
    {
        await AddItemAsync(_userId, "https://x.example/1", "quokka zulu", 1);
        await AddItemAsync(_userId, "https://x.example/2", "quokka alpha", 2);
        await AddItemAsync(_userId, "https://x.example/3", "unrelated", 3);
        await AddItemAsync(_userId, "https://quokka-site.example/p", null, 4);

        var all = await ReadAllAsync(2, ItemSearchPattern.ToContainsPattern("quokka"));

        Assert.Equal(["quokka alpha", "quokka zulu", "quokka-site.example"], Names(all));
    }

    [Fact]
    public async Task NameOrder_IsOnlyTheCallersOwnItems()
    {
        await AddItemAsync(_userId, "https://x.example/1", "Mine", 1);
        await AddItemAsync(_otherUserId, "https://x.example/2", "Aardvark of someone else", 2);

        Assert.Equal(["Mine"], Names(await ReadAllAsync(10)));
    }

    [Fact]
    public async Task NameOrder_LockedLinks_AreRedactedAndLastWithNoKey_NeverOrderedByTheirHiddenTitle()
    {
        var locked = await AddCollectionAsync(_userId, locked: true);
        var hidden = await AddItemAsync(_userId, "https://secret.example/private", "Aardvark hidden title", 1, memo: "hidden memo");
        await LinkAsync(locked.Id, hidden, _userId);
        await AddItemAsync(_userId, "https://x.example/1", "Zebra public", 2);
        await AddItemAsync(_userId, "https://x.example/2", "Mango public", 3);

        var store = new ItemStore(NewContext());
        var (firstPage, _, _) = await store.GetHistoryAsync(_userId, null, 2, null, ItemHistorySort.Name);
        var all = await ReadAllAsync(10);

        // By its hidden title "Aardvark" it would come first; instead it is last, after every visible link.
        Assert.Equal(hidden, all[^1].Id);
        Assert.Equal(["Mango public", "Zebra public"], all.Take(2).Select(item => item.Title));
        // The row itself carries nothing of what is hidden.
        var row = all[^1];
        Assert.True(row.IsCollectionLocked);
        Assert.Equal(string.Empty, row.Url);
        Assert.Null(row.Title);
        Assert.Null(row.Memo);
        Assert.Null(row.PreviewImageUrl);
        // And the cursor to the page that holds it names no hidden text.
        Assert.NotNull(firstPage.NextCursor);
        Assert.DoesNotContain("Aardvark", firstPage.NextCursor!.NameKey ?? "");
        var (secondPage, _, _) = await store.GetHistoryAsync(_userId, firstPage.NextCursor, 1, null, ItemHistorySort.Name);
        Assert.Equal(hidden, Assert.Single(secondPage.Items).Id);
    }

    [Fact]
    public async Task NameOrder_SeveralLockedLinks_KeepASafeOrder_NewestSavedFirst()
    {
        var locked = await AddCollectionAsync(_userId, locked: true);
        var first = await AddItemAsync(_userId, "https://s1.example/p", "Zulu secret", 1);
        var second = await AddItemAsync(_userId, "https://s2.example/p", "Alpha secret", 2);
        await LinkAsync(locked.Id, first, _userId);
        await LinkAsync(locked.Id, second, _userId);
        await AddItemAsync(_userId, "https://x.example/1", "Visible", 3);

        var all = await ReadAllAsync(1);

        // Not Alpha-then-Zulu (their hidden titles): the newest saved first.
        Assert.Equal(["Visible"], all.Take(1).Select(item => item.Title));
        Assert.Equal([second, first], all.Skip(1).Select(item => item.Id));
    }

    [Fact]
    public async Task NameOrder_AnotherPersonsLockedCollectionReference_DoesNotGateOrMoveMyLink()
    {
        // Someone else's locked Collection, my link put there by THEM: it is not mine to be locked out of.
        var theirs = await AddCollectionAsync(_otherUserId, locked: true);
        var mine = await AddItemAsync(_userId, "https://x.example/1", "Aardvark mine", 1);
        await LinkAsync(theirs.Id, mine, _otherUserId);
        await AddItemAsync(_userId, "https://x.example/2", "Zebra", 2);

        var all = await ReadAllAsync(10);

        Assert.Equal(["Aardvark mine", "Zebra"], Names(all));
        Assert.All(all, item => Assert.False(item.IsCollectionLocked));
    }

    [Fact]
    public async Task TimeOrder_IsUnchanged_NewestSavedFirst()
    {
        var oldest = await AddItemAsync(_userId, "https://x.example/1", "Zebra", 1);
        var middle = await AddItemAsync(_userId, "https://x.example/2", "Apple", 2);
        var newest = await AddItemAsync(_userId, "https://x.example/3", "Mango", 3);

        var (page, _, _) = await new ItemStore(NewContext()).GetHistoryAsync(_userId, null, 50);
        var (explicitTime, _, _) = await new ItemStore(NewContext()).GetHistoryAsync(_userId, null, 50, null, ItemHistorySort.Time);

        Assert.Equal([newest, middle, oldest], page.Items.Select(item => item.Id));
        Assert.Equal(page.Items.Select(item => item.Id), explicitTime.Items.Select(item => item.Id));
        Assert.Null(page.NextCursor);
    }
}

using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

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

    private async Task<Collection> AddCollectionAsync(long ownerId, bool locked, string? name = null)
    {
        var collection = new Collection(ownerId, name ?? (locked ? "Private" : "Open"), (name ?? (locked ? "Private" : "Open")).ToUpperInvariant(), CollectionIcon.Folder, Base);
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
        _db.CollectionItems.Add(CollectionItem.CreateNew(collectionId, itemId, addedByUserId, Base, 0));
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
    public async Task NameOrder_LinkInSeveralGatedCollections_IsListedOnce_AndAnOpenOneDoesNotUngateIt()
    {
        var lockedA = await AddCollectionAsync(_userId, locked: true, "Locked A");
        var lockedB = await AddCollectionAsync(_userId, locked: true, "Locked B");
        var open = await AddCollectionAsync(_userId, locked: false, "Open");
        var hidden = await AddItemAsync(_userId, "https://secret.example/p", "Aardvark hidden", 1);
        await LinkAsync(lockedA.Id, hidden, _userId);
        await LinkAsync(lockedB.Id, hidden, _userId);
        await LinkAsync(open.Id, hidden, _userId);
        var visible = await AddItemAsync(_userId, "https://x.example/1", "Visible in an open Collection", 2);
        await LinkAsync(open.Id, visible, _userId);

        var paged = await ReadAllAsync(1);

        // One row per link however many gated Collections hold it; gated wins over the open membership, and the open
        // Collection gates nothing.
        Assert.Equal([visible, hidden], paged.Select(item => item.Id));
        Assert.False(paged[0].IsCollectionLocked);
        Assert.True(paged[1].IsCollectionLocked);
        Assert.Null(paged[1].Title);
    }

    [Fact]
    public async Task NameOrder_SharedCollectionWithSharePassword_GatesMyLinkThere_OnlyWhileIAmAMember()
    {
        // Their Collections, my links added by me as a collaborator: one protected by a share password, one not.
        var protectedShared = await AddCollectionAsync(_otherUserId, locked: false, "Protected");
        var openShared = await AddCollectionAsync(_otherUserId, locked: false, "Shared");
        var formerShared = await AddCollectionAsync(_otherUserId, locked: false, "Former");
        _db.CollectionCollaborators.AddRange(
            new CollectionCollaborator(protectedShared.Id, _userId, CollectionCollaboratorRole.Contributor, _otherUserId, Base),
            new CollectionCollaborator(openShared.Id, _userId, CollectionCollaboratorRole.Contributor, _otherUserId, Base));
        _db.CollectionSharePasswords.AddRange(
            CollectionSharePassword.Create(protectedShared.Id, "hash", "sealed", Base),
            CollectionSharePassword.Create(formerShared.Id, "hash", "sealed", Base));
        await _db.SaveChangesAsync();
        var behindPassword = await AddItemAsync(_userId, "https://p.example/1", "Aardvark behind a share password", 1);
        var inOpenShared = await AddItemAsync(_userId, "https://p.example/2", "Mango shared", 2);
        var inFormerShared = await AddItemAsync(_userId, "https://p.example/3", "Banana no longer a member", 3);
        await LinkAsync(protectedShared.Id, behindPassword, _userId);
        await LinkAsync(openShared.Id, inOpenShared, _userId);
        await LinkAsync(formerShared.Id, inFormerShared, _userId);

        var all = await ReadAllAsync(1);

        // A Collection I am no longer a member of gates nothing for me (same as before this query shape).
        Assert.Equal([inFormerShared, inOpenShared, behindPassword], all.Select(item => item.Id));
        Assert.Equal([false, false, true], all.Select(item => item.IsCollectionLocked));
        Assert.Equal("sharePassword", all[^1].CollectionGate);
        Assert.Null(all[^1].Title);
    }

    [Fact]
    public async Task NameOrder_DeletedCollectionsLock_GatesNothing_AndTrashedLinksAreLeftOut()
    {
        var deletedLocked = await AddCollectionAsync(_userId, locked: true);
        var wasHidden = await AddItemAsync(_userId, "https://x.example/1", "Zebra once hidden", 1);
        await LinkAsync(deletedLocked.Id, wasHidden, _userId);
        deletedLocked.SoftDelete(Base.AddMinutes(10));
        var trashed = await AddItemAsync(_userId, "https://x.example/2", "Aardvark in the trash", 2);
        var kept = await AddItemAsync(_userId, "https://x.example/3", "Mango kept", 3);
        _db.Items.Single(item => item.Id == trashed).SoftDelete(Base.AddMinutes(10));
        await _db.SaveChangesAsync();

        var all = await ReadAllAsync(1);

        Assert.Equal([kept, wasHidden], all.Select(item => item.Id));
        Assert.All(all, item => Assert.False(item.IsCollectionLocked));
    }

    [Fact]
    public async Task NameOrder_PageQuery_ReadsTheGatedSetOnce_OnAFirstAndALaterPage()
    {
        var locked = await AddCollectionAsync(_userId, locked: true);
        var hidden = await AddItemAsync(_userId, "https://secret.example/p", "Hidden", 1);
        await LinkAsync(locked.Id, hidden, _userId);
        await AddItemAsync(_userId, "https://x.example/1", "Visible", 2);
        await AddItemAsync(_userId, "https://x.example/2", "Other", 3);
        var commands = new List<string>();
        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .LogTo(message => commands.Add(message), [RelationalEventId.CommandExecuted])
            .Options;
        var store = new ItemStore(new JupleDbContext(options));

        var (firstPage, _, _) = await store.GetHistoryAsync(_userId, null, 1, null, ItemHistorySort.Name);
        await store.GetHistoryAsync(_userId, firstPage.NextCursor, 1, null, ItemHistorySort.Name);

        // The name-order queries (the ones computing the bucket) join the caller's gated memberships once, instead of
        // repeating a correlated EXISTS in every select / order by / cursor expression (4x / 9x, measured on Dev as
        // ~34k / ~48k logical reads for a ~200-link archive).
        var nameOrderQueries = commands.Where(command => command.Contains("AS [Bucket]", StringComparison.Ordinal)).ToList();
        Assert.Equal(2, nameOrderQueries.Count);
        Assert.All(nameOrderQueries, sql =>
            Assert.Equal(1, CountOccurrences(sql, "FROM [collections].[CollectionItems]")));
    }

    private static int CountOccurrences(string text, string value)
    {
        var count = 0;
        for (var index = text.IndexOf(value, StringComparison.Ordinal); index >= 0; index = text.IndexOf(value, index + value.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
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

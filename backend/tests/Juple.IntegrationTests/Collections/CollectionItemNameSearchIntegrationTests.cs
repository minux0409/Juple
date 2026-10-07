using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Images;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The Collection Details link search in a NAME order (GET collections/{id}/items?q=&amp;sort=nameAsc|nameDesc) against the
/// real schema: the whole match set ordered by the visible name - the title, else the link host - with title-less links
/// last in both directions and equal names newest-added first; paged by an exact keyset (no duplicates, no gaps); the
/// order never reads a memo or anything a viewer of the card cannot already see; and the list's access and lock gates
/// stay in front of it.
/// </summary>
public sealed class CollectionItemNameSearchIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Now = new(2026, 10, 6, 0, 0, 0, TimeSpan.Zero);

    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private long _owner;
    private long _member;
    private long _stranger;
    private long _collectionId;
    private long _neighbourId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);

        var owner = new User("ko-KR", "Asia/Seoul", null, Now, Now);
        var member = new User("ko-KR", "Asia/Seoul", null, Now, Now);
        var stranger = new User("ko-KR", "Asia/Seoul", null, Now, Now);
        _db.Users.AddRange(owner, member, stranger);
        await _db.SaveChangesAsync();
        (_owner, _member, _stranger) = (owner.Id, member.Id, stranger.Id);

        _collectionId = (await _collections.CreateAsync(_owner, "Names", "NAMES", CollectionIcon.Folder, Now.AddSeconds(-2))).Id;
        _neighbourId = (await _collections.CreateAsync(_owner, "Neighbour", "NEIGHBOUR", CollectionIcon.Folder, Now.AddSeconds(-1))).Id;
        _db.CollectionCollaborators.Add(new CollectionCollaborator(_collectionId, _member, CollectionCollaboratorRole.Contributor, _owner, Now));
        await _db.SaveChangesAsync();

        var memberships = new List<(Item Item, long CollectionId, long AddedBy, DateTimeOffset AddedAt)>();
        void Link(long userId, string url, string? title, string? memo, long collectionId, DateTimeOffset addedAt)
        {
            var item = new Item(userId, url, Now.AddDays(-30));
            item.UpdateDetails(title, memo);
            memberships.Add((item, collectionId, userId, addedAt));
        }

        // Titled links, written out of order. The memo of one is a name-looking string that must never sort anything.
        Link(_owner, "https://a.example/1", "Cherry sneaker", null, _collectionId, Now.AddMinutes(-1));
        Link(_owner, "https://a.example/2", "Apple sneaker", null, _collectionId, Now.AddMinutes(-2));
        Link(_member, "https://a.example/3", "Banana sneaker", "AAA first memo", _collectionId, Now.AddMinutes(-3));
        // Title-less (blank counts as none): named by the host, "www." removed. Their memo is never the key either.
        Link(_owner, "https://www.mango-sneaker.example/p", null, "AAA memo of a title-less link", _collectionId, Now.AddMinutes(-4));
        Link(_owner, "https://kiwi-sneaker.example/p", "   ", null, _collectionId, Now.AddMinutes(-5));
        // Same title: newest added first; two links added at the very same instant tie-break by item id (newest id first).
        Link(_owner, "https://same.example/1", "Same sneaker", null, _collectionId, Now.AddMinutes(-10));
        Link(_owner, "https://same.example/2", "Same sneaker", null, _collectionId, Now.AddMinutes(-20));
        Link(_owner, "https://same.example/3", "Same sneaker", null, _collectionId, Now.AddMinutes(-20));
        // Not matched / not in this Collection / trashed.
        Link(_owner, "https://plain.example/1", "Plain", "sneaker memo only", _collectionId, Now.AddMinutes(-30));
        Link(_owner, "https://a.example/neighbour", "Aardvark sneaker", null, _neighbourId, Now.AddMinutes(-31));
        Link(_owner, "https://a.example/trashed", "Aaa trashed sneaker", null, _collectionId, Now.AddMinutes(-32));
        // A long run for paging: ties of title only differ by when they were added.
        for (var index = 0; index < 40; index++)
        {
            Link(_owner, $"https://page.example/{index}", $"Page sneaker {index % 20:D2}", null, _collectionId, Now.AddMinutes(-100 - index));
        }

        _db.Items.AddRange(memberships.Select(membership => membership.Item));
        await _db.SaveChangesAsync();
        var sortOrder = 0;
        _db.CollectionItems.AddRange(memberships.Select(membership =>
            new CollectionItem(membership.CollectionId, membership.Item.Id, membership.AddedBy, membership.AddedAt, sortOrder += 16)));
        await _db.SaveChangesAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE items.Items SET DeletedAtUtc = {Now} WHERE UserId = {_owner} AND Url = 'https://a.example/trashed'");
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _owner, _member, _stranger })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private GetCollectionItemsService Items() => new(_access, _collections, new NoImages());

    private async Task<List<CollectionItemEntryDto>> SearchAllAsync(long viewer, string term, CollectionItemSort sort, int pageSize, List<CollectionItemPageCursor>? cursors = null)
    {
        var seen = new List<CollectionItemEntryDto>();
        CollectionItemPageCursor? cursor = null;
        do
        {
            var page = await Items().SearchAsync(viewer, _collectionId, term, cursor, pageSize, sort);
            Assert.True(page.Items.Count <= pageSize);
            seen.AddRange(page.Items);
            cursor = page.NextCursor;
            if (cursor is not null)
            {
                cursors?.Add(cursor);
            }
        }
        while (cursor is not null);

        return seen;
    }

    private static string Titles(IEnumerable<CollectionItemEntryDto> entries) =>
        string.Join("|", entries.Select(entry => string.IsNullOrWhiteSpace(entry.Title) ? $"<{new Uri(entry.Url).Host}>" : entry.Title));

    [Fact]
    public async Task NameAsc_OrdersByTitle_ThenTitleLessByHost_AndNeverByMemo()
    {
        var results = await SearchAllAsync(_owner, "sneaker", CollectionItemSort.NameAsc, 100);

        var head = results.Take(9).ToList();
        Assert.Equal(
            "Apple sneaker|Banana sneaker|Cherry sneaker|Page sneaker 00|Page sneaker 00|Page sneaker 01|Page sneaker 01|Page sneaker 02|Page sneaker 02",
            Titles(head));
        // Title-less links come last, ordered by host without "www." (kiwi < mango), never by their memo ("AAA ...").
        Assert.Equal("<kiwi-sneaker.example>|<www.mango-sneaker.example>", Titles(results.TakeLast(2)));
        // The neighbour Collection's, the trashed one and a memo-only match are absent.
        Assert.DoesNotContain(results, entry => entry.Url.Contains("neighbour", StringComparison.Ordinal) || entry.Url.Contains("trashed", StringComparison.Ordinal));
        Assert.DoesNotContain(results, entry => entry.Title == "Plain");
    }

    [Fact]
    public async Task NameDesc_ReversesTheNames_ButKeepsTitleLessLast_AndTiesNewestFirst()
    {
        var results = await SearchAllAsync(_owner, "sneaker", CollectionItemSort.NameDesc, 100);

        var titled = results.Where(entry => !string.IsNullOrWhiteSpace(entry.Title)).ToList();
        var names = titled.Select(entry => entry.Title!).ToList();
        Assert.Equal(names.OrderByDescending(name => name, StringComparer.OrdinalIgnoreCase).ToList(), names);
        Assert.Equal("Same sneaker|Same sneaker|Same sneaker", Titles(titled.Take(3)));
        // Title-less stay at the END even when descending, themselves Z-A by host.
        Assert.Equal("<www.mango-sneaker.example>|<kiwi-sneaker.example>", Titles(results.TakeLast(2)));
        Assert.All(results.TakeLast(2), entry => Assert.True(string.IsNullOrWhiteSpace(entry.Title)));
    }

    [Theory]
    [InlineData(CollectionItemSort.NameAsc)]
    [InlineData(CollectionItemSort.NameDesc)]
    public async Task Name_PagesOneGlobalOrder_WithoutDuplicatesOrGaps_AtAnyPageSize(CollectionItemSort sort)
    {
        var all = await SearchAllAsync(_owner, "sneaker", sort, 100);
        // 3 titled + 40 pages + 3 same + 2 title-less = 48 matches.
        Assert.Equal(48, all.Count);

        foreach (var pageSize in new[] { 1, 3, 7, 10 })
        {
            var cursors = new List<CollectionItemPageCursor>();
            var paged = await SearchAllAsync(_owner, "sneaker", sort, pageSize, cursors);

            Assert.Equal(all.Select(entry => entry.ItemId), paged.Select(entry => entry.ItemId));
            Assert.Equal(paged.Count, paged.Select(entry => entry.ItemId).Distinct().Count());
            Assert.All(cursors, cursor => Assert.Equal(sort, cursor.Sort));
        }
    }

    [Fact]
    public async Task Name_EqualTitles_AreOrderedNewestAddedFirst_ThenByItemIdDescending()
    {
        foreach (var sort in new[] { CollectionItemSort.NameAsc, CollectionItemSort.NameDesc })
        {
            var same = (await SearchAllAsync(_owner, "same sneaker", sort, 1)).ToList();

            Assert.Equal(3, same.Count);
            Assert.Equal(same.OrderByDescending(entry => entry.AddedAtUtc).ThenByDescending(entry => entry.ItemId).Select(entry => entry.ItemId), same.Select(entry => entry.ItemId));
        }
    }

    [Fact]
    public async Task Name_ACursorOfTheOtherSortIsRefused_ByTheStore()
    {
        var first = await Items().SearchAsync(_owner, _collectionId, "sneaker", null, 5, CollectionItemSort.NameAsc);
        Assert.NotNull(first.NextCursor);

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => Items().SearchAsync(_owner, _collectionId, "sneaker", first.NextCursor, 5, CollectionItemSort.NameDesc));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => Items().SearchAsync(_owner, _collectionId, "sneaker", first.NextCursor, 5, CollectionItemSort.DateDesc));
    }

    [Fact]
    public async Task Name_TheCursorCarriesOnlyTheVisibleName_NeverAMemo()
    {
        // The page ends on the title-less "kiwi"/"mango" run: the keys that travel are the host names.
        var page = await Items().SearchAsync(_owner, _collectionId, "sneaker", null, 47, CollectionItemSort.NameAsc);
        Assert.NotNull(page.NextCursor);
        Assert.Equal(1, page.NextCursor!.NameBucket);
        Assert.Equal("kiwi-sneaker.example", page.NextCursor.NameKey);
        Assert.DoesNotContain("memo", CollectionItemPageCursorCodec.Encode(page.NextCursor), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Name_AMemberSeesTheSameOrder_AndAnotherMembersMemoStaysHidden()
    {
        var ownerView = await SearchAllAsync(_owner, "sneaker", CollectionItemSort.NameAsc, 100);
        var memberView = await SearchAllAsync(_member, "sneaker", CollectionItemSort.NameAsc, 100);

        Assert.Equal(ownerView.Select(entry => entry.ItemId), memberView.Select(entry => entry.ItemId));
        // The owner's own memo shows to the owner only, and a search never matches or orders by a memo.
        Assert.All(memberView.Where(entry => !entry.IsMine), entry => Assert.Null(entry.Memo));
        Assert.Empty(await SearchAllAsync(_member, "first memo", CollectionItemSort.NameAsc, 20));
        Assert.Empty(await SearchAllAsync(_owner, "memo only", CollectionItemSort.NameAsc, 20));
    }

    [Theory]
    [InlineData(CollectionItemSort.NameAsc)]
    [InlineData(CollectionItemSort.NameDesc)]
    public async Task Name_KeepsTheListsAccessAndLockGates(CollectionItemSort sort)
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => Items().SearchAsync(_stranger, _collectionId, "sneaker", null, 10, sort));

        await new CollectionLockStore(_db).LockAsync(_collectionId, Now);
        _db.ChangeTracker.Clear();
        // The Owner does not bypass the lock: nothing is searched or ordered without a grant.
        await Assert.ThrowsAsync<CollectionLockedException>(
            () => Items().SearchAsync(_owner, _collectionId, "sneaker", null, 10, sort));
    }

    [Fact]
    public async Task DateSearch_IsUnchanged()
    {
        var desc = await SearchAllAsync(_owner, "sneaker", CollectionItemSort.DateDesc, 10);
        var asc = await SearchAllAsync(_owner, "sneaker", CollectionItemSort.DateAsc, 10);

        Assert.Equal(48, desc.Count);
        Assert.Equal(desc.Select(entry => entry.ItemId).Reverse(), asc.Select(entry => entry.ItemId));
        Assert.Equal(desc.OrderByDescending(entry => entry.AddedAtUtc).ThenByDescending(entry => entry.ItemId).Select(entry => entry.ItemId), desc.Select(entry => entry.ItemId));
    }

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }
}

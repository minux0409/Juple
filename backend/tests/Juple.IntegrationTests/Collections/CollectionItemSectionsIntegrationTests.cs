using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.ListCollections;
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
/// A Collection's 일자순 summary + per-section paging against the real schema, with a large
/// Collection (1,200 links; one month alone 500, with a same-instant tie): the summary returns only
/// exact counts, each section's window pages through exactly its own links in either direction -
/// no duplicates, no gaps, nothing from outside it - and the same access and lock gates as the list
/// hold. Also: the Collections list itself pages 300 Collections without a duplicate or a gap.
/// </summary>
public sealed class CollectionItemSectionsIntegrationTests : IAsyncLifetime
{
    private const string Seoul = "Asia/Seoul";

    // Wednesday 2026-09-30 09:00 in Seoul. Sections: 오늘 09-30, 어제 09-29, 이번 주 09-27..09-28,
    // then 2026-09 (up to 09-26), 2026-08, 2026-07.
    private static readonly DateTimeOffset Now = new(2026, 9, 30, 0, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan SeoulOffset = TimeSpan.FromHours(9);

    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private long _owner;
    private long _stranger;
    private long _bigId;
    private long _smallId;
    private long _otherId;

    private static DateTimeOffset Local(int month, int day, int hour, int minute = 0, int second = 0) =>
        new DateTimeOffset(2026, month, day, hour, minute, second, SeoulOffset).ToUniversalTime();

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

        var owner = new User("ko-KR", Seoul, null, Now, Now);
        var stranger = new User("ko-KR", Seoul, null, Now, Now);
        _db.Users.AddRange(owner, stranger);
        await _db.SaveChangesAsync();
        (_owner, _stranger) = (owner.Id, stranger.Id);

        _bigId = (await _collections.CreateAsync(_owner, "Big", "BIG", CollectionIcon.Folder, Now.AddSeconds(-3))).Id;
        _smallId = (await _collections.CreateAsync(_owner, "Small", "SMALL", CollectionIcon.Folder, Now.AddSeconds(-2))).Id;
        _otherId = (await _collections.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, Now.AddSeconds(-1))).Id;

        var memberships = new List<(Item Item, long CollectionId, DateTimeOffset AddedAtUtc)>();
        void Add(long collectionId, int count, Func<int, DateTimeOffset> addedAt, string tag)
        {
            for (var index = 0; index < count; index++)
            {
                // The Item itself was saved long before - the section follows when it was added here.
                memberships.Add((new Item(_owner, $"https://example.test/{tag}/{index}", Local(1, 1, 12)), collectionId, addedAt(index)));
            }
        }

        Add(_bigId, 10, index => Local(9, 30, 8, index), "today");
        Add(_bigId, 19, index => Local(9, 29, 23, index), "yesterday");
        Add(_bigId, 1, _ => Local(9, 29, 0), "yesterday-first-instant"); // exactly local midnight -> 어제
        Add(_bigId, 29, index => Local(9, 27 + (index % 2), 12, index % 60), "week");
        Add(_bigId, 1, _ => Local(9, 29, 0).AddTicks(-1), "week-last-instant"); // one tick before 어제 -> 이번 주
        Add(_bigId, 140, index => Local(9, 1 + (index % 26), 10, index % 60), "september");
        Add(_bigId, 470, index => Local(8, 1 + (index % 31), 9, index % 60, index % 7), "august");
        Add(_bigId, 30, _ => Local(8, 15, 12), "august-tie"); // 30 links added at the very same instant
        Add(_bigId, 500, index => Local(7, 1 + (index % 31), 20, index % 60), "july");
        Add(_bigId, 5, index => Local(8, 20, 10, index), "trashed");
        Add(_otherId, 25, index => Local(8, 10, 10, index), "other-collection");
        Add(_smallId, 1, _ => Local(9, 30, 7), "small-today");
        Add(_smallId, 2, index => Local(7, 3, 7, index), "small-july");

        _db.Items.AddRange(memberships.Select(membership => membership.Item));
        await _db.SaveChangesAsync();
        _db.CollectionItems.AddRange(memberships.Select((membership, index) =>
            CollectionItem.CreateNew(membership.CollectionId, membership.Item.Id, _owner, membership.AddedAtUtc, index * 16)));
        await _db.SaveChangesAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE items.Items SET DeletedAtUtc = {Now} WHERE UserId = {_owner} AND Url LIKE 'https://example.test/trashed/%'");
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _owner, _stranger })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private GetCollectionItemSectionsService Sections() => new(_access, _collections, new FixedTimeProvider(Now));

    private GetCollectionItemsService Items() => new(_access, _collections, new NoImages());

    [Fact]
    public async Task TheSummary_IsExactCountsPerSection_WithoutAnyLinkData()
    {
        var sections = await Sections().GetAsync(_owner, _bigId, Seoul);

        Assert.Equal(
            [("2026-09-30", 10), ("2026-09-29", 20), ("thisWeek", 30), ("month:2026-09", 140), ("month:2026-08", 500), ("month:2026-07", 500)],
            sections.Select(section => (section.Key, section.Count)));
        // Every live link of this Collection is in exactly one section (trash and other Collections' links are not).
        Assert.Equal(1_200, sections.Sum(section => section.Count));
        Assert.Null(sections[0].ToUtc);
    }

    [Theory]
    [InlineData(CollectionItemSort.DateDesc)]
    [InlineData(CollectionItemSort.DateAsc)]
    public async Task EachSection_PagesThroughExactlyItsOwnLinks_InEitherDirection_NoDuplicates_NoGaps_TiesIncluded(CollectionItemSort sort)
    {
        var sections = await Sections().GetAsync(_owner, _bigId, Seoul);

        foreach (var section in sections)
        {
            var seen = new List<CollectionItemEntryDto>();
            CollectionItemPageCursor? cursor = null;
            var pages = 0;
            do
            {
                var page = await Items().GetRangeAsync(_owner, _bigId, section.FromUtc, section.ToUtc ?? DateTimeOffset.MaxValue, cursor, 25, sort);
                Assert.True(page.Items.Count <= 25);
                seen.AddRange(page.Items);
                cursor = page.NextCursor;
                pages++;
            }
            while (cursor is not null && pages < 100);

            Assert.Equal(section.Count, seen.Count);
            Assert.Equal(seen.Count, seen.Select(item => item.ItemId).Distinct().Count());
            Assert.All(seen, item => Assert.True(item.AddedAtUtc >= section.FromUtc && (section.ToUtc is null || item.AddedAtUtc < section.ToUtc)));
            Assert.DoesNotContain(seen, item => item.Url.Contains("/trashed/") || item.Url.Contains("/other-collection/"));
            var expected = sort == CollectionItemSort.DateAsc
                ? seen.OrderBy(item => item.AddedAtUtc).ThenBy(item => item.ItemId)
                : seen.OrderByDescending(item => item.AddedAtUtc).ThenByDescending(item => item.ItemId);
            Assert.Equal(expected.Select(item => item.ItemId), seen.Select(item => item.ItemId));
        }

        var august = sections.Single(section => section.Key == "month:2026-08");
        Assert.Equal(20, (int)Math.Ceiling(august.Count / 25.0));
    }

    [Fact]
    public async Task LocalMidnight_BelongsToTheDayItStarts()
    {
        var sections = await Sections().GetAsync(_owner, _bigId, Seoul);
        var yesterday = sections.Single(section => section.Kind == "yesterday");
        var thisWeek = sections.Single(section => section.Kind == "thisWeek");

        var yesterdayUrls = (await Items().GetRangeAsync(_owner, _bigId, yesterday.FromUtc, yesterday.ToUtc!.Value, null, 100, CollectionItemSort.DateDesc)).Items.Select(item => item.Url);
        var weekUrls = (await Items().GetRangeAsync(_owner, _bigId, thisWeek.FromUtc, thisWeek.ToUtc!.Value, null, 100, CollectionItemSort.DateDesc)).Items.Select(item => item.Url);

        Assert.Contains("https://example.test/yesterday-first-instant/0", yesterdayUrls);
        Assert.Contains("https://example.test/week-last-instant/0", weekUrls);
    }

    [Fact]
    public async Task RemovingALink_LowersItsSectionsCount_AndAnEmptiedSectionIsGone()
    {
        var before = await Sections().GetAsync(_owner, _smallId, Seoul);
        Assert.Equal([("2026-09-30", 1), ("month:2026-07", 2)], before.Select(section => (section.Key, section.Count)));

        var july = await Items().GetRangeAsync(_owner, _smallId, before[1].FromUtc, before[1].ToUtc!.Value, null, 25, CollectionItemSort.DateDesc);
        await _collections.RemoveAsync(_owner, _smallId, july.Items[0].ItemId);
        var today = await Items().GetRangeAsync(_owner, _smallId, before[0].FromUtc, DateTimeOffset.MaxValue, null, 25, CollectionItemSort.DateDesc);
        await _collections.RemoveAsync(_owner, _smallId, today.Items[0].ItemId);

        var after = await Sections().GetAsync(_owner, _smallId, Seoul);
        Assert.Equal([("month:2026-07", 1)], after.Select(section => (section.Key, section.Count)));
    }

    [Fact]
    public async Task TheSummary_HasTheSameGatesAsTheList_NoAccess_AndLocked()
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Sections().GetAsync(_stranger, _bigId, Seoul));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            Items().GetRangeAsync(_stranger, _bigId, DateTimeOffset.MinValue, DateTimeOffset.MaxValue, null, 25, CollectionItemSort.DateDesc));

        await new CollectionLockStore(_db).LockAsync(_otherId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => Sections().GetAsync(_owner, _otherId, Seoul));
        await Assert.ThrowsAsync<CollectionLockedException>(() =>
            Items().GetRangeAsync(_owner, _otherId, DateTimeOffset.MinValue, DateTimeOffset.MaxValue, null, 25, CollectionItemSort.DateDesc));
    }

    [Fact]
    public async Task WithoutAWindow_TheWholeCollectionPagesAsBefore()
    {
        var all = new List<long>();
        CollectionItemPageCursor? cursor = null;
        do
        {
            var page = await Items().GetAsync(_owner, _bigId, cursor, 100, sort: CollectionItemSort.DateDesc);
            all.AddRange(page.Items.Select(item => item.ItemId));
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        Assert.Equal(1_200, all.Count);
        Assert.Equal(1_200, all.Distinct().Count());
    }

    [Fact]
    public async Task TheCollectionsList_Pages300Collections_WithExactCounts_AndNoDuplicateOrGap()
    {
        var created = new List<long>();
        for (var index = 0; index < 297; index++)
        {
            created.Add((await _collections.CreateAsync(_owner, $"Bulk {index}", $"BULK {index}", CollectionIcon.Folder, Now.AddMinutes(index))).Id);
        }
        _db.ChangeTracker.Clear();

        var seen = new List<CollectionDto>();
        CollectionPageCursor? cursor = null;
        var pages = 0;
        do
        {
            var page = await _collections.ListAsync(_owner, itemId: null, excludeItemId: null, isFavorite: null, cursor, 24);
            Assert.True(page.Items.Count <= 24);
            seen.AddRange(page.Items);
            cursor = page.NextCursor;
            pages++;
        }
        while (cursor is not null && pages < 50);

        Assert.Equal(300, seen.Count);
        Assert.Equal(300, seen.Select(collection => collection.Id).Distinct().Count());
        Assert.Equal(13, pages);
        // Newest first across every page boundary.
        Assert.Equal(seen.OrderByDescending(collection => collection.CreatedAtUtc).ThenByDescending(collection => collection.Id).Select(collection => collection.Id), seen.Select(collection => collection.Id));
        // Each card's count comes with the page (the trash excluded) - no per-Collection request.
        Assert.Equal(1_200, seen.Single(collection => collection.Id == _bigId).ItemCount);
        Assert.Equal(3, seen.Single(collection => collection.Id == _smallId).ItemCount);
        Assert.All(seen.Where(collection => created.Contains(collection.Id)), collection => Assert.Equal(0, collection.ItemCount));
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }
}

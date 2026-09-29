using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemHistorySections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// The History summary + per-section paging against the real schema, with a large History
/// (1,200+ links; one month alone 470): the summary returns only exact counts, and each section's
/// window pages through exactly its own links - no duplicates, no gaps, nothing from outside it.
/// </summary>
public sealed class HistorySectionsIntegrationTests : IAsyncLifetime
{
    private const string Seoul = "Asia/Seoul";

    // Wednesday 2026-09-30 09:00 in Seoul. Sections: 오늘 09-30, 어제 09-29, 이번 주 09-27..09-28,
    // then 2026-09 (up to 09-26), 2026-08, 2026-07.
    private static readonly DateTimeOffset Now = new(2026, 9, 30, 0, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan SeoulOffset = TimeSpan.FromHours(9);

    private JupleDbContext _db = null!;
    private long _userId;
    private long _otherUserId;
    private long _emptyUserId;

    private static DateTimeOffset Local(int month, int day, int hour, int minute = 0, int second = 0) =>
        new DateTimeOffset(2026, month, day, hour, minute, second, SeoulOffset).ToUniversalTime();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        var user = new User("ko-KR", Seoul, null, Now, Now);
        var other = new User("ko-KR", Seoul, null, Now, Now);
        var empty = new User("ko-KR", Seoul, null, Now, Now);
        _db.Users.AddRange(user, other, empty);
        await _db.SaveChangesAsync();
        (_userId, _otherUserId, _emptyUserId) = (user.Id, other.Id, empty.Id);

        var items = new List<Item>();
        void Add(long owner, int count, Func<int, DateTimeOffset> savedAt, string tag)
        {
            for (var index = 0; index < count; index++)
            {
                items.Add(new Item(owner, $"https://example.test/{tag}/{index}", savedAt(index)));
            }
        }

        Add(_userId, 12, index => Local(9, 30, 8, index), "today");
        Add(_userId, 30, index => Local(9, 29, 23, index), "yesterday");
        Add(_userId, 1, _ => Local(9, 29, 0), "yesterday-first-instant"); // exactly local midnight -> 어제
        Add(_userId, 83, index => Local(9, 27 + (index % 2), 12, index % 60), "week");
        Add(_userId, 1, _ => Local(9, 29, 0).AddTicks(-1), "week-last-instant"); // one tick before 어제 -> 이번 주
        Add(_userId, 153, index => Local(9, 1 + (index % 26), 10, index % 60), "september");
        Add(_userId, 440, index => Local(8, 1 + (index % 31), 9, index % 60, index % 7), "august");
        Add(_userId, 30, _ => Local(8, 15, 12), "august-tie"); // 30 links saved at the very same instant
        Add(_userId, 450, index => Local(7, 1 + (index % 31), 20, index % 60), "july");
        Add(_otherUserId, 25, index => Local(8, 10, 10, index), "someone-else");
        Add(_userId, 5, index => Local(8, 20, 10, index), "trashed");

        _db.Items.AddRange(items);
        await _db.SaveChangesAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE items.Items SET DeletedAtUtc = {Now} WHERE UserId = {_userId} AND Url LIKE 'https://example.test/trashed/%'");
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId IN ({_userId}, {_otherUserId}, {_emptyUserId})");
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id IN ({_userId}, {_otherUserId}, {_emptyUserId})");
        await _db.DisposeAsync();
    }

    private GetItemHistorySectionsService Sections() => new(new ItemStore(_db), new FixedTimeProvider(Now));

    [Fact]
    public async Task TheSummary_IsExactCountsPerSection_WithoutAnyLinkData()
    {
        var sections = await Sections().GetAsync(_userId, Seoul);

        Assert.Equal(
            [("2026-09-30", 12), ("2026-09-29", 31), ("thisWeek", 84), ("month:2026-09", 153), ("month:2026-08", 470), ("month:2026-07", 450)],
            sections.Select(section => (section.Key, section.Count)));
        Assert.Equal([HistorySectionKinds.Today, HistorySectionKinds.Yesterday, HistorySectionKinds.ThisWeek, "month", "month", "month"], sections.Select(section => section.Kind));
        Assert.Equal((2026, 8), (sections[4].Year, sections[4].Month));
        // Every live link of the user is in exactly one section (trash and other users' links are not).
        Assert.Equal(1_200, sections.Sum(section => section.Count));
    }

    [Fact]
    public async Task HomesToday_FromTheDevicesLocalMidnight_CountsAndPagesExactlyTheSameLinks()
    {
        // Home asks for its own today: from the device's local midnight, open-ended.
        var history = new GetItemHistoryService(new ItemStore(_db), new NoImages());
        foreach (var (fromUtc, expected) in new[] { (Local(9, 30, 0), 12), (Local(9, 29, 0), 12 + 31) })
        {
            var count = await history.CountRangeAsync(_userId, fromUtc, DateTimeOffset.MaxValue);
            var seen = new List<long>();
            ItemHistoryPageCursor? cursor = null;
            do
            {
                var page = await history.GetRangeAsync(_userId, fromUtc, DateTimeOffset.MaxValue, cursor, 5);
                seen.AddRange(page.Items.Select(item => item.Id));
                cursor = page.NextCursor;
            }
            while (cursor is not null);

            Assert.Equal(expected, count);
            Assert.Equal(expected, seen.Count);
            Assert.Equal(seen.Count, seen.Distinct().Count());
        }

        // Nobody else's links, and nothing in the trash, is ever counted.
        Assert.Equal(0, await history.CountRangeAsync(_emptyUserId, Local(1, 1, 0), DateTimeOffset.MaxValue));
    }

    [Fact]
    public async Task AnEmptyHistory_HasNoSections()
    {
        Assert.Empty(await Sections().GetAsync(_emptyUserId, Seoul));
    }

    [Fact]
    public async Task EachSection_PagesThroughExactlyItsOwnLinks_NoDuplicates_NoGaps_TiesIncluded()
    {
        var sections = await Sections().GetAsync(_userId, Seoul);
        var history = new GetItemHistoryService(new ItemStore(_db), new NoImages());

        foreach (var section in sections)
        {
            var seen = new List<ItemHistoryEntryDto>();
            ItemHistoryPageCursor? cursor = null;
            var pages = 0;
            do
            {
                var page = await history.GetRangeAsync(_userId, section.FromUtc, section.ToUtc ?? DateTimeOffset.MaxValue, cursor, 25);
                Assert.True(page.Items.Count <= 25);
                seen.AddRange(page.Items);
                cursor = page.NextCursor;
                pages++;
            }
            while (cursor is not null && pages < 100);

            Assert.Equal(section.Count, seen.Count);
            Assert.Equal(seen.Count, seen.Select(item => item.Id).Distinct().Count());
            Assert.All(seen, item => Assert.True(item.SavedAtUtc >= section.FromUtc && (section.ToUtc is null || item.SavedAtUtc < section.ToUtc)));
            Assert.DoesNotContain(seen, item => item.Url.Contains("/trashed/") || item.Url.Contains("/someone-else/"));
            // Newest first, and the (SavedAtUtc, Id) order holds across page boundaries.
            Assert.Equal(seen.OrderByDescending(item => item.SavedAtUtc).ThenByDescending(item => item.Id).Select(item => item.Id), seen.Select(item => item.Id));
        }

        var august = sections.Single(section => section.Key == "month:2026-08");
        Assert.Equal(19, (int)Math.Ceiling(august.Count / 25.0));
    }

    [Fact]
    public async Task ALocalMidnight_BelongsToTheDayItStarts()
    {
        var sections = await Sections().GetAsync(_userId, Seoul);
        var history = new GetItemHistoryService(new ItemStore(_db), new NoImages());

        async Task<IReadOnlyList<string>> UrlsOf(string key)
        {
            var section = sections.Single(entry => entry.Key == key);
            return (await history.GetRangeAsync(_userId, section.FromUtc, section.ToUtc ?? DateTimeOffset.MaxValue, null, 100)).Items.Select(item => item.Url).ToList();
        }

        Assert.Contains("https://example.test/yesterday-first-instant/0", await UrlsOf("2026-09-29"));
        Assert.Contains("https://example.test/week-last-instant/0", await UrlsOf("thisWeek"));
    }

    [Fact]
    public async Task DeletingALink_LowersItsSectionsCount_AndEmptiedSectionsDisappear()
    {
        var store = new ItemStore(_db);
        var todayIds = await _db.Items.AsNoTracking()
            .Where(item => item.UserId == _userId && item.Url.StartsWith("https://example.test/today/"))
            .Select(item => item.Id)
            .ToListAsync();

        await store.DeleteAsync(_userId, todayIds[0], Now);
        _db.ChangeTracker.Clear();
        Assert.Equal(11, (await Sections().GetAsync(_userId, Seoul)).Single(section => section.Key == "2026-09-30").Count);

        foreach (var id in todayIds.Skip(1))
        {
            await store.DeleteAsync(_userId, id, Now);
        }

        _db.ChangeTracker.Clear();
        Assert.DoesNotContain(await Sections().GetAsync(_userId, Seoul), section => section.Key == "2026-09-30");
    }

    [Fact]
    public async Task WithoutAWindow_TheHistoryEndpointsQueryIsUnchanged()
    {
        var history = new GetItemHistoryService(new ItemStore(_db), new NoImages());

        var page = await history.GetAsync(_userId, null, 50);

        Assert.Equal(50, page.Items.Count);
        Assert.NotNull(page.NextCursor);
        Assert.StartsWith("https://example.test/today/", page.Items[0].Url);
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

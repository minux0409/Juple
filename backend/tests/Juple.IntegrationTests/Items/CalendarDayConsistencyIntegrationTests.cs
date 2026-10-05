using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemHistoryByDate;
using Juple.Application.Items.GetItemHistoryCalendar;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// ONE meaning of "a calendar day" for the calendar view: for every day of a month, the number the month summary
/// shows equals the number of links the by-date list returns for that day - in the user's stored time zone, with links
/// placed one tick either side of local midnight, and across daylight-saving days (23 h / 25 h). Archive and Collection.
/// </summary>
public sealed class CalendarDayConsistencyIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private long _owner;
    private long _stranger;

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

        var now = DateTimeOffset.UtcNow;
        var owner = new User("en-US", "UTC", null, now, now);
        var stranger = new User("en-US", "UTC", null, now, now);
        _db.Users.AddRange(owner, stranger);
        await _db.SaveChangesAsync();
        (_owner, _stranger) = (owner.Id, stranger.Id);
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

    /// <summary>Instants one tick either side of every local midnight of the month plus a mid-day one, 1-3 links each.</summary>
    private static IReadOnlyList<DateTimeOffset> BoundaryInstants(int year, int month, string zoneId)
    {
        var days = CalendarMonthRanges.Days(year, month, zoneId);
        var instants = new List<DateTimeOffset>();
        foreach (var (day, index) in days.Select((day, index) => (day, index)))
        {
            instants.Add(day.FromUtc);                                   // exactly local midnight -> this day
            instants.Add(day.FromUtc.AddTicks(-1));                      // one tick before -> the previous day
            instants.Add(day.FromUtc + ((day.ToUtc - day.FromUtc) / 2)); // mid-day
            if (index % 3 == 0)
            {
                instants.Add(day.ToUtc.AddTicks(-1)); // the last instant of the day
            }
        }

        return instants;
    }

    private async Task<long> NewCollectionAsync() =>
        (await _collections.CreateAsync(_owner, $"Cal-{Guid.NewGuid():N}"[..20], $"CAL{Guid.NewGuid():N}"[..20], CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

    public static TheoryData<string, int, int> Months() => new()
    {
        { "Asia/Seoul", 2026, 10 },
        { "America/Los_Angeles", 2026, 10 },
        { "America/New_York", 2026, 3 },   // spring forward: a 23 h day
        { "America/New_York", 2026, 11 },  // fall back: a 25 h day
        { "Australia/Sydney", 2026, 10 },  // southern-hemisphere spring forward
        { "Pacific/Auckland", 2026, 9 },
    };

    [Theory]
    [MemberData(nameof(Months))]
    public async Task Archive_EveryDaysCount_EqualsItsByDateList_AndNothingIsLostOrCounted_Twice(string zoneId, int year, int month)
    {
        var instants = BoundaryInstants(year, month, zoneId);
        _db.Items.AddRange(instants.Select((instant, index) => new Item(_owner, $"https://example.test/{zoneId}/{year}-{month}/{index}", instant)));
        // Someone else's links and a trashed one never count.
        _db.Items.Add(new Item(_stranger, "https://example.test/stranger", instants[3]));
        var trashed = new Item(_owner, "https://example.test/trashed", instants[5]);
        _db.Items.Add(trashed);
        await _db.SaveChangesAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE items.Items SET DeletedAtUtc = {DateTimeOffset.UtcNow} WHERE Id = {trashed.Id}");
        _db.ChangeTracker.Clear();

        var store = new ItemStore(_db);
        var calendar = await new GetItemHistoryCalendarService(store).GetAsync(_owner, zoneId, year, month);
        var byDate = new GetItemHistoryByDateService(store, new NoImages());

        var counted = 0;
        for (var day = 1; day <= DateTime.DaysInMonth(year, month); day++)
        {
            var date = new DateOnly(year, month, day);
            var expected = calendar.Days.FirstOrDefault(entry => entry.Date == date.ToString("yyyy-MM-dd"))?.Count ?? 0;
            var listed = 0;
            ItemHistoryPageCursor? cursor = null;
            do
            {
                var page = await byDate.GetAsync(_owner, zoneId, date, cursor, 7);
                listed += page.Items.Count;
                cursor = page.NextCursor;
            }
            while (cursor is not null);

            Assert.True(expected == listed, $"{zoneId} {date}: the month says {expected}, the day lists {listed}");
            counted += listed;
        }

        // Every live link of the user inside this month's window is on exactly one day.
        var window = (From: CalendarMonthRanges.Days(year, month, zoneId)[0].FromUtc, To: CalendarMonthRanges.Days(year, month, zoneId)[^1].ToUtc);
        var inMonth = await _db.Items.AsNoTracking().CountAsync(item => item.UserId == _owner && item.DeletedAtUtc == null && item.SavedAtUtc >= window.From && item.SavedAtUtc < window.To);
        Assert.Equal(inMonth, counted);
        Assert.Equal(inMonth, calendar.Days.Sum(entry => entry.Count));
    }

    [Theory]
    [MemberData(nameof(Months))]
    public async Task Collection_EveryDaysCount_EqualsItsByDateList_InBothDateOrders(string zoneId, int year, int month)
    {
        var collectionId = await NewCollectionAsync();
        var instants = BoundaryInstants(year, month, zoneId);
        var items = instants.Select((instant, index) => new Item(_owner, $"https://example.test/c/{zoneId}/{year}-{month}/{index}", new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero))).ToList();
        _db.Items.AddRange(items);
        await _db.SaveChangesAsync();
        // The day follows when each link was ADDED to this Collection, not when the Item was saved.
        _db.CollectionItems.AddRange(items.Select((item, index) => new CollectionItem(collectionId, item.Id, _owner, instants[index], index * 16)));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var calendar = await new GetCollectionItemCalendarService(_access, _collections).GetAsync(_owner, collectionId, zoneId, year, month);
        var service = new GetCollectionItemsService(_access, _collections, new NoImages());

        foreach (var sort in new[] { CollectionItemSort.DateDesc, CollectionItemSort.DateAsc })
        {
            var counted = 0;
            for (var day = 1; day <= DateTime.DaysInMonth(year, month); day++)
            {
                var date = new DateOnly(year, month, day);
                var expected = calendar.Days.FirstOrDefault(entry => entry.Date == date.ToString("yyyy-MM-dd"))?.Count ?? 0;
                var listed = 0;
                CollectionItemPageCursor? cursor = null;
                do
                {
                    var page = await service.GetByDateAsync(_owner, collectionId, zoneId, date, cursor, 7, sort);
                    listed += page.Items.Count;
                    cursor = page.NextCursor;
                }
                while (cursor is not null);

                Assert.True(expected == listed, $"{zoneId} {date} {sort}: the month says {expected}, the day lists {listed}");
                counted += listed;
            }

            // Every link inside the month is on exactly one day (the instant one tick before the 1st belongs to last month).
            var window = CalendarMonthRanges.Days(year, month, zoneId);
            Assert.Equal(instants.Count(instant => instant >= window[0].FromUtc && instant < window[^1].ToUtc), counted);
        }
    }

    [Fact]
    public async Task Collection_TheSameInstantIsADifferentDay_InADifferentStoredTimeZone_ForCountAndListAlike()
    {
        var collectionId = await NewCollectionAsync();
        // 2026-10-05 16:30 UTC = Oct 6 01:30 in Seoul, Oct 5 09:30 in Los Angeles.
        var instant = new DateTimeOffset(2026, 10, 5, 16, 30, 0, TimeSpan.Zero);
        var item = new Item(_owner, "https://example.test/tz", instant);
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        _db.CollectionItems.Add(new CollectionItem(collectionId, item.Id, _owner, instant, 0));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var service = new GetCollectionItemsService(_access, _collections, new NoImages());
        foreach (var (zone, date) in new[] { ("Asia/Seoul", new DateOnly(2026, 10, 6)), ("America/Los_Angeles", new DateOnly(2026, 10, 5)) })
        {
            var month = await new GetCollectionItemCalendarService(_access, _collections).GetAsync(_owner, collectionId, zone, 2026, 10);
            Assert.Equal(date.ToString("yyyy-MM-dd"), Assert.Single(month.Days).Date);
            Assert.Single((await service.GetByDateAsync(_owner, collectionId, zone, date, null, 10, CollectionItemSort.DateDesc)).Items);
            // The neighbouring day holds nothing - the list and the count never disagree.
            Assert.Empty((await service.GetByDateAsync(_owner, collectionId, zone, date.AddDays(-1), null, 10, CollectionItemSort.DateDesc)).Items);
            Assert.Empty((await service.GetByDateAsync(_owner, collectionId, zone, date.AddDays(1), null, 10, CollectionItemSort.DateDesc)).Items);
        }
    }

    [Fact]
    public async Task Collection_ByDate_KeepsTheListsAccessGate()
    {
        var collectionId = await NewCollectionAsync();
        var service = new GetCollectionItemsService(_access, _collections, new NoImages());

        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            service.GetByDateAsync(_stranger, collectionId, "Asia/Seoul", new DateOnly(2026, 10, 5), null, 10, CollectionItemSort.DateDesc));
    }

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }
}

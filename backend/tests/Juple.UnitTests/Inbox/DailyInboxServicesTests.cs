using Juple.Application.Inbox;
using Juple.Application.Inbox.GetDailyInbox;
using Juple.Application.Inbox.SaveInboxEntry;

namespace Juple.UnitTests.Inbox;

public sealed class DailyInboxServicesTests
{
    [Theory]
    [InlineData("https://shop.example/item")]
    [InlineData("http://shop.example/item")]
    public async Task SaveAsync_WhenUrlUsesHttpOrHttps_SavesTrimmedUrl(string url)
    {
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        await service.SaveAsync(17, new SaveInboxEntryCommand($"  {url}  "));

        Assert.Equal(17, store.SavedUserId);
        Assert.Equal(url, store.SavedUrl);
    }

    [Theory]
    [InlineData("/relative/path")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///local/file")]
    [InlineData("data:text/plain,content")]
    public async Task SaveAsync_WhenUrlIsNotHttpOrHttps_RejectsRequest(string url)
    {
        var service = new InboxEntrySaveService(new FakeInboxEntryStore(), new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidInboxRequestException>(
            () => service.SaveAsync(17, new SaveInboxEntryCommand(url)));

        Assert.Equal("url", exception.Field);
    }

    [Fact]
    public async Task SaveAsync_PreservesUrlQueryString()
    {
        const string url = "https://shop.example/item?id=1&variant=500ml";
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        await service.SaveAsync(17, new SaveInboxEntryCommand(url));

        Assert.Equal(url, store.SavedUrl);
    }

    [Fact]
    public async Task SaveAsync_WhenUrlIsExactly4096Characters_SavesUrl()
    {
        var url = "https://a.co/" + new string('a', 4083);
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        await service.SaveAsync(17, new SaveInboxEntryCommand(url));

        Assert.Equal(4096, store.SavedUrl?.Length);
    }

    [Fact]
    public async Task SaveAsync_WhenUrlExceeds4096Characters_RejectsRequest()
    {
        var url = "https://a.co/" + new string('a', 4084);
        var service = new InboxEntrySaveService(new FakeInboxEntryStore(), new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidInboxRequestException>(
            () => service.SaveAsync(17, new SaveInboxEntryCommand(url)));

        Assert.Equal("url", exception.Field);
    }

    [Fact]
    public async Task GetAsync_FiltersUsingCurrentUserAndPreservesStoreOrder()
    {
        var expectedItems = new List<InboxEntryDto>
        {
            new(12, "https://example.test/newer", new DateTimeOffset(2026, 8, 29, 16, 0, 0, TimeSpan.Zero)),
            new(11, "https://example.test/older", new DateTimeOffset(2026, 8, 29, 15, 0, 0, TimeSpan.Zero)),
        };
        var store = new FakeInboxEntryStore { DailyItems = expectedItems };
        var service = new GetDailyInboxService(store, new FixedTimeProvider());

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30));

        Assert.Equal(17, store.DailyUserId);
        Assert.Equal(expectedItems, result.Items);
        Assert.Equal(new DateOnly(2026, 8, 30), result.Date);
    }

    [Fact]
    public void Calculate_WhenDateIsDstSpringTransition_DoesNotAssumeTwentyFourHours()
    {
        var range = DailyInboxDateRangeCalculator.Calculate(
            new DateOnly(2026, 3, 8),
            "America/New_York");

        Assert.Equal(TimeSpan.FromHours(23), range.ToUtc - range.FromUtc);
    }

    [Fact]
    public async Task GetAsync_WhenDateIsOmitted_UsesCurrentUserLocalDate()
    {
        var store = new FakeInboxEntryStore();
        var service = new GetDailyInboxService(
            store,
            new FixedTimeProvider(new DateTimeOffset(2026, 8, 29, 15, 30, 0, TimeSpan.Zero)));

        var result = await service.GetAsync(17, "Asia/Seoul", date: null);

        Assert.Equal(new DateOnly(2026, 8, 30), result.Date);
    }

    private sealed class FakeInboxEntryStore : IInboxEntryStore
    {
        public long? SavedUserId { get; private set; }

        public string? SavedUrl { get; private set; }

        public long? DailyUserId { get; private set; }

        public IReadOnlyList<InboxEntryDto> DailyItems { get; init; } = [];

        public Task<InboxEntryDto> SaveAsync(
            long userId,
            string url,
            DateTimeOffset savedAtUtc,
            CancellationToken cancellationToken = default)
        {
            SavedUserId = userId;
            SavedUrl = url;
            return Task.FromResult(new InboxEntryDto(1, url, savedAtUtc));
        }

        public Task<IReadOnlyList<InboxEntryDto>> GetDailyAsync(
            long userId,
            DateTimeOffset fromUtc,
            DateTimeOffset toUtc,
            CancellationToken cancellationToken = default)
        {
            DailyUserId = userId;
            return Task.FromResult(DailyItems);
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);
    }
}
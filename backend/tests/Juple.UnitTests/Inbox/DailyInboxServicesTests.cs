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
    public async Task SaveAsync_WhenClientRequestIdIsAbsent_AllowsSameUrlTwice()
    {
        const string url = "https://shop.example/item";
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        var first = await service.SaveAsync(17, new SaveInboxEntryCommand(url));
        var second = await service.SaveAsync(17, new SaveInboxEntryCommand(url));

        Assert.True(first.Created);
        Assert.True(second.Created);
        Assert.NotEqual(first.Entry.Id, second.Entry.Id);
    }

    [Fact]
    public async Task SaveAsync_WhenClientRequestIdIsNew_ReturnsCreatedTrue()
    {
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        var result = await service.SaveAsync(
            17,
            new SaveInboxEntryCommand("https://shop.example/item", Guid.NewGuid()));

        Assert.True(result.Created);
    }

    [Fact]
    public async Task SaveAsync_WhenSameUserAndClientRequestIdAndUrlRepeat_ReplaysExistingEntryWithoutNewSave()
    {
        const string url = "https://shop.example/item";
        var clientRequestId = Guid.NewGuid();
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        var first = await service.SaveAsync(17, new SaveInboxEntryCommand(url, clientRequestId));
        var replay = await service.SaveAsync(17, new SaveInboxEntryCommand(url, clientRequestId));

        Assert.True(first.Created);
        Assert.False(replay.Created);
        Assert.Equal(first.Entry.Id, replay.Entry.Id);
    }

    [Fact]
    public async Task SaveAsync_WhenSameUserAndClientRequestIdButDifferentUrl_ThrowsConflict()
    {
        var clientRequestId = Guid.NewGuid();
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        await service.SaveAsync(
            17, new SaveInboxEntryCommand("https://shop.example/item-a", clientRequestId));

        await Assert.ThrowsAsync<InboxEntryClientRequestConflictException>(() =>
            service.SaveAsync(
                17, new SaveInboxEntryCommand("https://shop.example/item-b", clientRequestId)));
    }

    [Fact]
    public async Task SaveAsync_WhenDifferentUsersShareSameClientRequestId_BothCreateSeparateEntries()
    {
        const string url = "https://shop.example/item";
        var clientRequestId = Guid.NewGuid();
        var store = new FakeInboxEntryStore();
        var service = new InboxEntrySaveService(store, new FixedTimeProvider());

        var userOneResult = await service.SaveAsync(17, new SaveInboxEntryCommand(url, clientRequestId));
        var userTwoResult = await service.SaveAsync(23, new SaveInboxEntryCommand(url, clientRequestId));

        Assert.True(userOneResult.Created);
        Assert.True(userTwoResult.Created);
        Assert.NotEqual(userOneResult.Entry.Id, userTwoResult.Entry.Id);
    }

    [Fact]
    public void Calculate_WhenDateIsDstSpringTransition_DoesNotAssumeTwentyFourHours()
    {
        var range = DailyInboxDateRangeCalculator.Calculate(
            new DateOnly(2026, 3, 8),
            "America/New_York");

        Assert.Equal(TimeSpan.FromHours(23), range.ToUtc - range.FromUtc);
    }

    private sealed class FakeInboxEntryStore : IInboxEntryStore
    {
        private readonly Dictionary<(long UserId, Guid ClientRequestId), InboxEntryDto> _byClientRequestId = [];
        private long _nextId = 1;

        public long? SavedUserId { get; private set; }

        public string? SavedUrl { get; private set; }

        public Task<InboxEntrySaveResult> SaveAsync(
            long userId,
            string url,
            Guid? clientRequestId,
            DateTimeOffset savedAtUtc,
            CancellationToken cancellationToken = default)
        {
            SavedUserId = userId;
            SavedUrl = url;

            if (clientRequestId is { } requestId)
            {
                var key = (userId, requestId);
                if (_byClientRequestId.TryGetValue(key, out var existing))
                {
                    if (existing.Url != url)
                    {
                        throw new InboxEntryClientRequestConflictException();
                    }

                    return Task.FromResult(new InboxEntrySaveResult(existing, Created: false));
                }

                var created = new InboxEntryDto(_nextId++, url, savedAtUtc);
                _byClientRequestId[key] = created;
                return Task.FromResult(new InboxEntrySaveResult(created, Created: true));
            }

            return Task.FromResult(new InboxEntrySaveResult(
                new InboxEntryDto(_nextId++, url, savedAtUtc), Created: true));
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 8, 29, 0, 0, 0, TimeSpan.Zero);
    }
}

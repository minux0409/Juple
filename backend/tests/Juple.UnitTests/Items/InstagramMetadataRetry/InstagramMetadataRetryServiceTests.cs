using Juple.Application.Items.InstagramMetadataRetry;
using Juple.Application.UrlMetadata;
using Juple.Infrastructure.Items;

namespace Juple.UnitTests.Items.InstagramMetadataRetry;

public sealed class InstagramMetadataRetryServiceTests
{
    private const string InstagramUrl = "https://www.instagram.com/p/Dc71q9mR3xf/";
    private const string YouTubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    private const string GenericUrl = "https://example.com/some/article";

    private sealed class FakeTimeProvider : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeUrlMetadataResolver(params UrlMetadataResult[] results) : IUrlMetadataResolver
    {
        private readonly Queue<UrlMetadataResult> _results = new(results);

        public int CallCount { get; private set; }

        public List<string> RequestedUrls { get; } = [];

        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default)
        {
            CallCount++;
            RequestedUrls.Add(url);
            var result = _results.Count > 0 ? _results.Dequeue() : new UrlMetadataResult(null, null, null);
            return Task.FromResult(result);
        }
    }

    /// <summary>Pure in-memory stand-in that mirrors InstagramMetadataRetryStore's own contract
    /// (discovery eligibility, single-task-per-Item, atomic claim, field-level apply, attempt
    /// bookkeeping) precisely enough to exercise InstagramMetadataRetryService's orchestration
    /// end-to-end without a real database. The Instagram-host filter itself
    /// (IsEligibleInstagramCandidateUrl) is exercised directly against the real store below,
    /// not re-implemented here - this fake defers to it too, so "YouTube/general URL never
    /// registered" is tested against the actual production predicate either way.</summary>
    private sealed class FakeInstagramMetadataRetryStore : IInstagramMetadataRetryStore
    {
        private sealed class ItemState
        {
            public required string Url;
            public required DateTimeOffset SavedAtUtc;
            public string? Title;
            public string? PreviewImageUrl;
            public bool Deleted;
        }

        private sealed class TaskState
        {
            public required long ItemId;
            public int AttemptCount;
            public DateTimeOffset NextAttemptAtUtc;
            public DateTimeOffset? ClaimedAtUtc;
        }

        private long _nextItemId = 1;
        private long _nextTaskId = 1;
        private readonly Dictionary<long, ItemState> _items = [];
        private readonly Dictionary<long, TaskState> _tasks = [];

        public int RegisterCallCount { get; private set; }

        public long AddItem(
            string url, DateTimeOffset savedAtUtc, string? title = null, string? previewImageUrl = null)
        {
            var id = _nextItemId++;
            _items[id] = new ItemState
            {
                Url = url, SavedAtUtc = savedAtUtc, Title = title, PreviewImageUrl = previewImageUrl,
            };
            return id;
        }

        public long PreRegisterTask(long itemId, int attemptCount, DateTimeOffset nextAttemptAtUtc)
        {
            var id = _nextTaskId++;
            _tasks[id] = new TaskState
            {
                ItemId = itemId, AttemptCount = attemptCount, NextAttemptAtUtc = nextAttemptAtUtc,
            };
            return id;
        }

        public (string? Title, string? PreviewImageUrl) GetItemFields(long itemId) =>
            (_items[itemId].Title, _items[itemId].PreviewImageUrl);

        public void DeleteItem(long itemId) => _items[itemId].Deleted = true;

        public int TaskCountForItem(long itemId) => _tasks.Values.Count(task => task.ItemId == itemId);

        public bool TryClaimDirectly(long taskId, DateTimeOffset claimedAtUtc) =>
            _tasks.TryGetValue(taskId, out var task) && task.ClaimedAtUtc is null
                ? Set(task, claimedAtUtc)
                : false;

        private static bool Set(TaskState task, DateTimeOffset claimedAtUtc)
        {
            task.ClaimedAtUtc = claimedAtUtc;
            return true;
        }

        public Task RegisterNewCandidatesAsync(
            DateTimeOffset now, TimeSpan discoveryWindow, TimeSpan firstAttemptDelay,
            CancellationToken cancellationToken = default)
        {
            RegisterCallCount++;
            var earliest = now - discoveryWindow;
            var latest = now - firstAttemptDelay;

            foreach (var (itemId, item) in _items)
            {
                if (item.Deleted) continue;
                if (item.SavedAtUtc < earliest || item.SavedAtUtc > latest) continue;
                if (item.Title is not null && item.PreviewImageUrl is not null) continue;
                if (!InstagramMetadataRetryStore.IsEligibleInstagramCandidateUrl(item.Url)) continue;
                if (_tasks.Values.Any(task => task.ItemId == itemId)) continue;

                _tasks[_nextTaskId++] = new TaskState { ItemId = itemId, AttemptCount = 0, NextAttemptAtUtc = now };
            }

            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<DueInstagramMetadataRetryTaskDto>> ListDueAsync(
            DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            IReadOnlyList<DueInstagramMetadataRetryTaskDto> due = _tasks
                .Where(entry => entry.Value.NextAttemptAtUtc <= now)
                .OrderBy(entry => entry.Value.NextAttemptAtUtc)
                .Select(entry => new DueInstagramMetadataRetryTaskDto(
                    entry.Key, entry.Value.ItemId, _items[entry.Value.ItemId].Url, entry.Value.AttemptCount))
                .ToList();
            return Task.FromResult(due);
        }

        public Task<bool> TryClaimAsync(
            long taskId, DateTimeOffset claimedAtUtc, DateTimeOffset staleClaimBeforeUtc,
            CancellationToken cancellationToken = default)
        {
            if (!_tasks.TryGetValue(taskId, out var task))
            {
                return Task.FromResult(false);
            }

            if (task.ClaimedAtUtc is { } claimed && claimed >= staleClaimBeforeUtc)
            {
                return Task.FromResult(false);
            }

            task.ClaimedAtUtc = claimedAtUtc;
            return Task.FromResult(true);
        }

        public Task<(string? Title, string? PreviewImageUrl)?> GetItemMetadataStateAsync(
            long itemId, CancellationToken cancellationToken = default)
        {
            if (!_items.TryGetValue(itemId, out var item) || item.Deleted)
            {
                return Task.FromResult<(string?, string?)?>(null);
            }

            return Task.FromResult<(string?, string?)?>((item.Title, item.PreviewImageUrl));
        }

        public Task ApplyResolvedMetadataAsync(
            long itemId, string? title, string? previewImageUrl, CancellationToken cancellationToken = default)
        {
            if (!_items.TryGetValue(itemId, out var item) || item.Deleted)
            {
                return Task.CompletedTask;
            }

            if (title is not null && item.Title is null)
            {
                item.Title = title;
            }

            if (previewImageUrl is not null && item.PreviewImageUrl is null)
            {
                item.PreviewImageUrl = previewImageUrl;
            }

            return Task.CompletedTask;
        }

        public Task DeleteAsync(long taskId, CancellationToken cancellationToken = default)
        {
            _tasks.Remove(taskId);
            return Task.CompletedTask;
        }

        public Task RecordFailedAttemptAsync(
            long taskId, DateTimeOffset attemptedAtUtc, string? errorCode, DateTimeOffset nextAttemptAtUtc,
            CancellationToken cancellationToken = default)
        {
            if (_tasks.TryGetValue(taskId, out var task))
            {
                task.AttemptCount++;
                task.NextAttemptAtUtc = nextAttemptAtUtc;
                task.ClaimedAtUtc = null;
            }

            return Task.CompletedTask;
        }

        public Task MarkExhaustedAsync(
            long taskId, DateTimeOffset attemptedAtUtc, string? errorCode,
            CancellationToken cancellationToken = default)
        {
            if (_tasks.TryGetValue(taskId, out var task))
            {
                task.AttemptCount++;
                task.NextAttemptAtUtc = DateTimeOffset.MaxValue;
                task.ClaimedAtUtc = null;
            }

            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task RunOnceAsync_InitialFetchNeverHappened_ThenResolverSucceeds_BackfillsTitleAndImage()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2));
        var resolver = new FakeUrlMetadataResolver(
            new UrlMetadataResult("realuser on Instagram: \"a caption\"", UrlMetadataSource.OpenGraph, "https://scontent.cdninstagram.com/real.jpg"));
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var result = await service.RunOnceAsync();

        Assert.Equal(1, resolver.CallCount);
        Assert.Equal(1, result.Resolved);
        var (title, image) = store.GetItemFields(itemId);
        Assert.Equal("realuser on Instagram: \"a caption\"", title);
        Assert.Equal("https://scontent.cdninstagram.com/real.jpg", image);
        Assert.Equal(0, store.TaskCountForItem(itemId));
    }

    [Fact]
    public async Task RunOnceAsync_ItemAlreadyFullyResolved_NeverRegistersATask_AndNeverCallsTheResolver()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        store.AddItem(
            InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2),
            title: "already on Instagram: \"caption\"", previewImageUrl: "https://scontent.cdninstagram.com/x.jpg");
        var resolver = new FakeUrlMetadataResolver();
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var result = await service.RunOnceAsync();

        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, result.DueTaskCount);
    }

    [Fact]
    public async Task RunOnceAsync_BothBackendAttemptsFail_GivesUpAndNeverRetriesAgain()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2));
        var resolver = new FakeUrlMetadataResolver(
            new UrlMetadataResult(null, null, null),
            new UrlMetadataResult(null, null, null));
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var firstRun = await service.RunOnceAsync();
        Assert.Equal(1, firstRun.Rescheduled);
        Assert.Equal(1, resolver.CallCount);
        Assert.Equal(1, store.TaskCountForItem(itemId));

        time.Now += InstagramMetadataRetryService.SecondAttemptDelay;
        var secondRun = await service.RunOnceAsync();
        Assert.Equal(1, secondRun.GaveUp);
        Assert.Equal(2, resolver.CallCount);
        // The exhausted task row is deliberately kept (not deleted) - see
        // InstagramMetadataRetryTask.MarkExhausted's own remarks.
        Assert.Equal(1, store.TaskCountForItem(itemId));

        // Critical regression case: the Item is STILL well inside the 30-minute discovery window
        // here (both fields are still null) - without the exhausted row staying behind as a
        // marker, discovery would treat it as a brand new candidate and silently restart the whole
        // 2-attempt cycle, exceeding "최대 2회 추가 시도". A few minutes later, still well within
        // the window, must change nothing.
        time.Now += TimeSpan.FromMinutes(3);
        var thirdRun = await service.RunOnceAsync();
        Assert.Equal(2, resolver.CallCount);
        Assert.Equal(0, thirdRun.DueTaskCount);
        Assert.Equal(1, store.TaskCountForItem(itemId));

        // And well past the discovery window entirely, still nothing.
        time.Now += TimeSpan.FromHours(1);
        var fourthRun = await service.RunOnceAsync();
        Assert.Equal(2, resolver.CallCount);
        Assert.Equal(0, fourthRun.DueTaskCount);
    }

    [Fact]
    public async Task RunOnceAsync_TaskAlreadyClaimedByAnotherWorker_NeverProcessesItTwice()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2));
        var taskId = store.PreRegisterTask(itemId, attemptCount: 0, nextAttemptAtUtc: time.Now);
        // Simulate a second, overlapping worker run that already holds the claim.
        Assert.True(store.TryClaimDirectly(taskId, time.Now));

        var resolver = new FakeUrlMetadataResolver(
            new UrlMetadataResult("someone on Instagram: \"x\"", UrlMetadataSource.OpenGraph, "https://scontent.cdninstagram.com/x.jpg"));
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var result = await service.RunOnceAsync();

        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(1, result.SkippedNotClaimed);
        var (title, image) = store.GetItemFields(itemId);
        Assert.Null(title);
        Assert.Null(image);
    }

    [Fact]
    public async Task RunOnceAsync_ItemWasDeletedWhileTaskWasPending_ClosesTheTaskWithoutFetching()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2));
        store.PreRegisterTask(itemId, attemptCount: 0, nextAttemptAtUtc: time.Now);
        store.DeleteItem(itemId);
        var resolver = new FakeUrlMetadataResolver();
        var service = new InstagramMetadataRetryService(store, resolver, time);

        await service.RunOnceAsync();

        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, store.TaskCountForItem(itemId));
    }

    [Fact]
    public async Task RunOnceAsync_UserAlreadyEditedTitle_NeverOverwritesIt_ButStillBackfillsTheStillMissingImage()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(
            InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2), title: "My own custom title");
        var resolver = new FakeUrlMetadataResolver(
            new UrlMetadataResult("fetcheduser on Instagram: \"fetched caption\"", UrlMetadataSource.OpenGraph, "https://scontent.cdninstagram.com/real.jpg"));
        var service = new InstagramMetadataRetryService(store, resolver, time);

        await service.RunOnceAsync();

        var (title, image) = store.GetItemFields(itemId);
        Assert.Equal("My own custom title", title);
        Assert.Equal("https://scontent.cdninstagram.com/real.jpg", image);
    }

    [Fact]
    public async Task RunOnceAsync_ResolverReturnsTitleButNoImage_AppliesOnlyTheTitle_AndKeepsRetryingForTheImage()
    {
        // Mirrors what happens when UrlMetadataResolver's own generic-icon guard (already tested in
        // UrlMetadataResolverTests) rejects the image but the title still resolved - the retry path
        // must apply the title without treating a still-null image as a fabricated success.
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromMinutes(2));
        var resolver = new FakeUrlMetadataResolver(
            new UrlMetadataResult("partialuser on Instagram: \"caption\"", UrlMetadataSource.OpenGraph, null));
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var result = await service.RunOnceAsync();

        Assert.Equal(1, result.Rescheduled);
        var (title, image) = store.GetItemFields(itemId);
        Assert.Equal("partialuser on Instagram: \"caption\"", title);
        Assert.Null(image);
        Assert.Equal(1, store.TaskCountForItem(itemId));
    }

    [Theory]
    [InlineData(YouTubeUrl)]
    [InlineData(GenericUrl)]
    public async Task RunOnceAsync_NonInstagramUrl_IsNeverRegisteredOrFetched(string url)
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        store.AddItem(url, savedAtUtc: time.Now - TimeSpan.FromMinutes(2));
        var resolver = new FakeUrlMetadataResolver();
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var result = await service.RunOnceAsync();

        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, result.DueTaskCount);
    }

    [Fact]
    public async Task RunOnceAsync_ItemSavedTooRecently_IsNotYetEligible_UntilFirstAttemptDelayElapses()
    {
        var time = new FakeTimeProvider();
        var store = new FakeInstagramMetadataRetryStore();
        var itemId = store.AddItem(InstagramUrl, savedAtUtc: time.Now - TimeSpan.FromSeconds(10));
        var resolver = new FakeUrlMetadataResolver(
            new UrlMetadataResult("u on Instagram: \"c\"", UrlMetadataSource.OpenGraph, "https://scontent.cdninstagram.com/x.jpg"));
        var service = new InstagramMetadataRetryService(store, resolver, time);

        var tooEarly = await service.RunOnceAsync();
        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, tooEarly.DueTaskCount);

        time.Now += InstagramMetadataRetryService.FirstAttemptDelay;
        var nowEligible = await service.RunOnceAsync();
        Assert.Equal(1, resolver.CallCount);
        Assert.Equal(1, nowEligible.Resolved);
        Assert.NotNull(store.GetItemFields(itemId).Title);
    }
}

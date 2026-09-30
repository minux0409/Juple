using Azure;
using Azure.Core;
using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Juple.Api.Storage;
using Juple.Infrastructure.Images;
using Microsoft.Extensions.Logging;

namespace Juple.UnitTests.Images;

/// <summary>
/// The shared User Delegation Key fetch: one per process at a time, never cancelled by a caller's
/// request, only a success is cached - and the log says what happened without leaking anything.
/// </summary>
public sealed class UserDelegationKeyCacheTests
{
    [Fact]
    public async Task TwentyConcurrentCallers_OnACold_Cache_ShareOneFetch_AndTheKeyIsThenCached()
    {
        var storage = new FakeBlobServiceClient();
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        storage.Acquire = _ => gate.Task;
        var cache = new UserDelegationKeyCache(storage);

        var callers = Enumerable.Range(0, 20).Select(_ => cache.GetOrRefreshAsync(CancellationToken.None)).ToList();
        await WaitUntilAsync(() => storage.Calls == 1);
        var key = FakeBlobServiceClient.NewKey();
        gate.SetResult(key);
        var keys = await Task.WhenAll(callers);

        Assert.All(keys, received => Assert.Same(key, received));
        Assert.Equal(1, storage.Calls);
        Assert.Same(key, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(1, storage.Calls);
    }

    [Fact]
    public async Task OneCallersRequestBeingAborted_StopsOnlyItsWait_NeverTheSharedFetch()
    {
        var storage = new FakeBlobServiceClient();
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        CancellationToken fetchToken = default;
        storage.Acquire = token =>
        {
            fetchToken = token;
            return gate.Task;
        };
        var cache = new UserDelegationKeyCache(storage);
        using var requestA = new CancellationTokenSource();

        var callerA = cache.GetOrRefreshAsync(requestA.Token);
        var callerB = cache.GetOrRefreshAsync(CancellationToken.None);
        await WaitUntilAsync(() => storage.Calls == 1);
        requestA.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => callerA);
        Assert.False(fetchToken.IsCancellationRequested);
        Assert.False(callerB.IsCompleted);

        var key = FakeBlobServiceClient.NewKey();
        gate.SetResult(key);
        Assert.Same(key, await callerB);
        Assert.Same(key, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(1, storage.Calls);
    }

    [Fact]
    public async Task TheAppsTimeoutThenRetry_FindsTheKeyTheFirstFetchKeptGettingFor()
    {
        var storage = new FakeBlobServiceClient();
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        storage.Acquire = _ => gate.Task;
        var cache = new UserDelegationKeyCache(storage);

        // The first request gives up (the app's 8-second GET timeout) while the fetch is still going.
        using var firstRequest = new CancellationTokenSource();
        var first = cache.GetOrRefreshAsync(firstRequest.Token);
        await WaitUntilAsync(() => storage.Calls == 1);
        firstRequest.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);

        // The fetch finishes after that; the app's retry arrives and needs no new fetch.
        var key = FakeBlobServiceClient.NewKey();
        gate.SetResult(key);
        await WaitUntilAsync(() => cache.GetOrRefreshAsync(CancellationToken.None).IsCompletedSuccessfully);

        Assert.Same(key, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(1, storage.Calls);
    }

    [Fact]
    public async Task ARetryArrivingWhileTheFetchIsStillRunning_JoinsIt()
    {
        var storage = new FakeBlobServiceClient();
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        storage.Acquire = _ => gate.Task;
        var cache = new UserDelegationKeyCache(storage);
        using var firstRequest = new CancellationTokenSource();
        var first = cache.GetOrRefreshAsync(firstRequest.Token);
        await WaitUntilAsync(() => storage.Calls == 1);
        firstRequest.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);

        var retry = cache.GetOrRefreshAsync(CancellationToken.None);
        var key = FakeBlobServiceClient.NewKey();
        gate.SetResult(key);

        Assert.Same(key, await retry);
        Assert.Equal(1, storage.Calls);
    }

    [Fact]
    public async Task AFailedFetch_IsNotCached_TheNextCallerFetchesAgain_AndTheWarningCarriesStatusAndCode()
    {
        var storage = new FakeBlobServiceClient();
        var logger = new ListLogger<UserDelegationKeyCache>();
        var key = FakeBlobServiceClient.NewKey();
        storage.Acquire = _ => storage.Calls == 1
            ? Task.FromException<UserDelegationKey>(new RequestFailedException(403, "This request is not authorized.", "AuthorizationPermissionMismatch", null))
            : Task.FromResult(key);
        var cache = new UserDelegationKeyCache(storage, logger: logger);

        var failure = await Assert.ThrowsAsync<RequestFailedException>(() => cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(403, failure.Status);
        Assert.Same(key, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(2, storage.Calls);

        var warning = Assert.Single(logger.Entries, entry => entry.Level == LogLevel.Warning);
        Assert.Contains("failed", warning.Message, StringComparison.Ordinal);
        Assert.Contains("RequestFailedException", warning.Message, StringComparison.Ordinal);
        Assert.Contains("status 403", warning.Message, StringComparison.Ordinal);
        Assert.Contains("AuthorizationPermissionMismatch", warning.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AFetchPastTheInternalLimit_TimesOut_IsNotCached_AndIsAWarningUnlikeACallersCancel()
    {
        var storage = new FakeBlobServiceClient();
        var logger = new ListLogger<UserDelegationKeyCache>();
        var key = FakeBlobServiceClient.NewKey();
        storage.Acquire = async token =>
        {
            if (storage.Calls == 1)
            {
                await Task.Delay(Timeout.Infinite, token);
            }

            return key;
        };
        var cache = new UserDelegationKeyCache(storage, logger: logger, acquisitionTimeout: TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAsync<TimeoutException>(() => cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Warning && entry.Message.Contains("timed out", StringComparison.Ordinal));

        Assert.Same(key, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(2, storage.Calls);
    }

    [Fact]
    public async Task AKeyIsReusedUntil20MinutesAreLeft_ThenRefreshedOnce_EvenForConcurrentCallers()
    {
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 9, 30, 0, 0, 0, TimeSpan.Zero));
        var storage = new FakeBlobServiceClient();
        var logger = new ListLogger<UserDelegationKeyCache>();
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstKey = FakeBlobServiceClient.NewKey();
        storage.Acquire = _ => storage.Calls == 1 ? Task.FromResult(firstKey) : gate.Task;
        var cache = new UserDelegationKeyCache(storage, clock, logger);

        Assert.Same(firstKey, await cache.GetOrRefreshAsync(CancellationToken.None));
        clock.Now = clock.Now.AddMinutes(39); // 21 minutes left
        Assert.Same(firstKey, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(1, storage.Calls);

        clock.Now = clock.Now.AddMinutes(1); // 20 minutes left: refresh
        var refreshing = Enumerable.Range(0, 5).Select(_ => cache.GetOrRefreshAsync(CancellationToken.None)).ToList();
        await WaitUntilAsync(() => storage.Calls == 2);
        var secondKey = FakeBlobServiceClient.NewKey();
        gate.SetResult(secondKey);

        Assert.All(await Task.WhenAll(refreshing), key => Assert.Same(secondKey, key));
        Assert.Equal(2, storage.Calls);
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Information && entry.Message.Contains("reason Refresh", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ASuccess_LogsItsElapsedTime_AndReason_AtInformation_OnlyWhenAFetchHappens()
    {
        var storage = new FakeBlobServiceClient { Acquire = _ => Task.FromResult(FakeBlobServiceClient.NewKey()) };
        var logger = new ListLogger<UserDelegationKeyCache>();
        var cache = new UserDelegationKeyCache(storage, logger: logger);

        await cache.GetOrRefreshAsync(CancellationToken.None);
        for (var i = 0; i < 10; i++)
        {
            await cache.GetOrRefreshAsync(CancellationToken.None);
        }

        Assert.Equal(2, logger.Entries.Count);
        Assert.Contains("started (reason Request, first True)", logger.Entries[0].Message, StringComparison.Ordinal);
        Assert.Matches(@"succeeded in \d+ ms \(reason Request, first True\)", logger.Entries[1].Message);
        Assert.All(logger.Entries, entry => Assert.Equal(LogLevel.Information, entry.Level));
    }

    [Fact]
    public async Task ShuttingDown_StopsAnUnfinishedFetch_WithoutAWarning()
    {
        var storage = new FakeBlobServiceClient();
        var logger = new ListLogger<UserDelegationKeyCache>();
        storage.Acquire = async token =>
        {
            await Task.Delay(Timeout.Infinite, token);
            return FakeBlobServiceClient.NewKey();
        };
        var cache = new UserDelegationKeyCache(storage, logger: logger);
        var caller = cache.GetOrRefreshAsync(CancellationToken.None);
        await WaitUntilAsync(() => storage.Calls == 1);

        cache.Dispose();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => caller);
        Assert.DoesNotContain(logger.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    // ---------- API warm-up ----------

    [Fact]
    public async Task WarmUp_NeverHoldsUpStartup_AndARequestDuringIt_JoinsTheSameFetch()
    {
        var storage = new FakeBlobServiceClient();
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        storage.Acquire = _ => gate.Task;
        var logger = new ListLogger<UserDelegationKeyCache>();
        var cache = new UserDelegationKeyCache(storage, logger: logger);
        using var warmup = new UserDelegationKeyWarmupService(storage, cache, new ListLogger<UserDelegationKeyWarmupService>());

        var startup = warmup.StartAsync(CancellationToken.None);
        Assert.True(startup.IsCompleted);
        await WaitUntilAsync(() => storage.Calls == 1);

        var request = cache.GetOrRefreshAsync(CancellationToken.None);
        var key = FakeBlobServiceClient.NewKey();
        gate.SetResult(key);

        Assert.Same(key, await request);
        await warmup.ExecuteTask!;
        Assert.Equal(1, storage.Calls);
        Assert.Contains("reason Warmup", logger.Entries[0].Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AfterASuccessfulWarmUp_TheFirstRequestNeedsNoFetch()
    {
        var storage = new FakeBlobServiceClient { Acquire = _ => Task.FromResult(FakeBlobServiceClient.NewKey()) };
        var cache = new UserDelegationKeyCache(storage);
        using var warmup = new UserDelegationKeyWarmupService(storage, cache, new ListLogger<UserDelegationKeyWarmupService>());

        await warmup.StartAsync(CancellationToken.None);
        await warmup.ExecuteTask!;
        await cache.GetOrRefreshAsync(CancellationToken.None);

        Assert.Equal(1, storage.Calls);
    }

    [Fact]
    public async Task AFailedWarmUp_EndsQuietly_TheHostKeepsRunning_AndARequestTriesAgain()
    {
        var storage = new FakeBlobServiceClient();
        var key = FakeBlobServiceClient.NewKey();
        storage.Acquire = _ => storage.Calls == 1
            ? Task.FromException<UserDelegationKey>(new RequestFailedException(503, "Server busy.", "ServerBusy", null))
            : Task.FromResult(key);
        var cache = new UserDelegationKeyCache(storage);
        var warmupLogger = new ListLogger<UserDelegationKeyWarmupService>();
        using var warmup = new UserDelegationKeyWarmupService(storage, cache, warmupLogger);

        await warmup.StartAsync(CancellationToken.None);
        await warmup.ExecuteTask!;

        Assert.True(warmup.ExecuteTask!.IsCompletedSuccessfully);
        Assert.Contains(warmupLogger.Entries, entry => entry.Message.Contains("did not complete", StringComparison.Ordinal));
        Assert.Same(key, await cache.GetOrRefreshAsync(CancellationToken.None));
        Assert.Equal(2, storage.Calls);
    }

    [Fact]
    public async Task WarmUp_IsSkippedWhereASharedKeySignsLocally()
    {
        var storage = new FakeBlobServiceClient(new StorageSharedKeyCredential("devaccount", Convert.ToBase64String(new byte[32])));
        var cache = new UserDelegationKeyCache(storage);
        using var warmup = new UserDelegationKeyWarmupService(storage, cache, new ListLogger<UserDelegationKeyWarmupService>());

        await warmup.StartAsync(CancellationToken.None);
        await warmup.ExecuteTask!;

        Assert.Equal(0, storage.Calls);
    }

    internal static async Task WaitUntilAsync(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++)
        {
            await Task.Delay(10);
        }

        Assert.True(condition());
    }
}

/// <summary>A BlobServiceClient whose User Delegation Key fetch is scripted by the test.</summary>
internal sealed class FakeBlobServiceClient : BlobServiceClient
{
    private int calls;

    /// <summary>Shared Key signing (Azurite/local) - no delegation key needed at all.</summary>
    public FakeBlobServiceClient(StorageSharedKeyCredential sharedKey)
        : base(new Uri("https://devaccount.blob.core.windows.net"), sharedKey)
    {
    }

    public FakeBlobServiceClient()
        : base(new Uri("https://devaccount.blob.core.windows.net"), new FakeTokenCredential())
    {
    }

    public Func<CancellationToken, Task<UserDelegationKey>> Acquire { get; set; } =
        _ => Task.FromResult(NewKey());

    public int Calls => Volatile.Read(ref calls);

    public override async Task<Response<UserDelegationKey>> GetUserDelegationKeyAsync(
        DateTimeOffset? startsOn,
        DateTimeOffset expiresOn,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref calls);
        var key = await Acquire(cancellationToken);
        return Response.FromValue(key, null!);
    }

    public static UserDelegationKey NewKey() =>
        BlobsModelFactory.UserDelegationKey(
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddHours(1),
            "b",
            "2025-01-05",
            Convert.ToBase64String(Guid.NewGuid().ToByteArray().Concat(Guid.NewGuid().ToByteArray()).ToArray()));

    private sealed class FakeTokenCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new("not-a-real-token", DateTimeOffset.UtcNow.AddHours(1));

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            ValueTask.FromResult(GetToken(requestContext, cancellationToken));
    }
}

internal sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>Keeps every log entry (level + rendered message) for assertions.</summary>
internal sealed class ListLogger<T> : ILogger<T>
{
    private readonly object gate = new();
    private readonly List<(LogLevel Level, string Message)> entries = [];

    public IReadOnlyList<(LogLevel Level, string Message)> Entries
    {
        get
        {
            lock (gate)
            {
                return entries.ToList();
            }
        }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        lock (gate)
        {
            entries.Add((logLevel, formatter(state, exception) + (exception is null ? string.Empty : " | " + exception)));
        }
    }
}

using System.Diagnostics;
using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.Infrastructure.Images;

/// <summary>Why a User Delegation Key is being fetched - only for the acquisition log.</summary>
public enum UserDelegationKeyAcquisitionSource
{
    /// <summary>The API's background warm-up right after start (see UserDelegationKeyWarmupService).</summary>
    Warmup,

    /// <summary>A request needed a read URL and no key was cached yet.</summary>
    Request,

    /// <summary>A request needed a read URL and the cached key was about to expire.</summary>
    Refresh,
}

/// <summary>
/// Caches the Production User Delegation Key across requests (registered as a Singleton) so a
/// per-Blob read URL can be signed without a network round trip to Azure AD/Storage on every
/// call - the key itself can sign any number of SAS tokens for its whole validity window. Not
/// used on the Azurite/local path, which signs directly with a Shared Key credential instead.
///
/// Fetching a key is shared: at most one fetch is in flight per process, and every caller that
/// needs a key meanwhile waits for that same fetch. It is never tied to any caller's request -
/// a caller whose request is aborted (e.g. the app's 8-second GET timeout while the very first
/// fetch of a fresh process is still getting its Managed Identity token) stops waiting, but the
/// fetch carries on and the key is there for the next request instead of starting over. The fetch
/// itself is bounded only by AcquisitionTimeout and by this cache being disposed (the app
/// shutting down). Only a fetched key is cached: a failed or timed-out fetch leaves nothing
/// behind, so the next caller starts a new one.
/// </summary>
public sealed class UserDelegationKeyCache : IDisposable
{
    /// <summary>Upper bound for one fetch (Managed Identity token + the Storage call).</summary>
    public static readonly TimeSpan DefaultAcquisitionTimeout = TimeSpan.FromSeconds(30);

    private static readonly TimeSpan KeyValidity = TimeSpan.FromHours(1);

    // Must stay comfortably above ItemImageStore.ReadUrlTtl (currently 15 minutes): Azure rejects
    // a SAS whose ExpiresOn is later than the User Delegation Key that signed it, so a key must
    // never be handed out with less remaining validity than the longest SAS it could be asked to
    // sign - otherwise the very last read URLs signed before a refresh would be born already
    // rejected by Storage.
    private static readonly TimeSpan RefreshBuffer = TimeSpan.FromMinutes(20);

    private readonly BlobServiceClient blobServiceClient;
    private readonly TimeProvider timeProvider;
    private readonly ILogger<UserDelegationKeyCache> logger;
    private readonly TimeSpan acquisitionTimeout;
    private readonly CancellationTokenSource lifetime = new();
    private readonly object gate = new();

    // A single immutable snapshot rather than two separate fields: the unsynchronized read on the
    // fast path below must never be able to observe a torn combination of one refresh's Key with
    // another refresh's ExpiresOn - reading one reference is atomic, reading two fields is not.
    private CachedKey? cached;
    private Task<UserDelegationKey>? inFlight;
    private int acquisitionCount;

    public UserDelegationKeyCache(
        BlobServiceClient blobServiceClient,
        TimeProvider? timeProvider = null,
        ILogger<UserDelegationKeyCache>? logger = null,
        TimeSpan? acquisitionTimeout = null)
    {
        this.blobServiceClient = blobServiceClient;
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.logger = logger ?? NullLogger<UserDelegationKeyCache>.Instance;
        this.acquisitionTimeout = acquisitionTimeout ?? DefaultAcquisitionTimeout;
    }

    public Task<UserDelegationKey> GetOrRefreshAsync(CancellationToken cancellationToken) =>
        GetOrRefreshAsync(UserDelegationKeyAcquisitionSource.Request, cancellationToken);

    /// <param name="cancellationToken">Cancels only this caller's wait - never the shared fetch.</param>
    public Task<UserDelegationKey> GetOrRefreshAsync(UserDelegationKeyAcquisitionSource source, CancellationToken cancellationToken)
    {
        var snapshot = cached;
        if (IsStillValid(snapshot))
        {
            return Task.FromResult(snapshot!.Key);
        }

        Task<UserDelegationKey> shared;
        lock (gate)
        {
            snapshot = cached;
            if (IsStillValid(snapshot))
            {
                return Task.FromResult(snapshot!.Key);
            }

            if (inFlight is null)
            {
                var reason = source == UserDelegationKeyAcquisitionSource.Request && snapshot is not null
                    ? UserDelegationKeyAcquisitionSource.Refresh
                    : source;
                inFlight = AcquireAsync(reason);
            }

            shared = inFlight;
        }

        return shared.WaitAsync(cancellationToken);
    }

    private async Task<UserDelegationKey> AcquireAsync(UserDelegationKeyAcquisitionSource reason)
    {
        // Never runs any part of the fetch synchronously inside the caller's lock.
        await Task.Yield();

        var number = Interlocked.Increment(ref acquisitionCount);
        var started = Stopwatch.GetTimestamp();
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        bounded.CancelAfter(acquisitionTimeout);
        logger.LogInformation(
            "User delegation key acquisition started (reason {Reason}, first {IsFirst}).",
            reason,
            number == 1);
        try
        {
            var startsOn = timeProvider.GetUtcNow();
            var expiresOn = startsOn.Add(KeyValidity);
            UserDelegationKey key = await blobServiceClient.GetUserDelegationKeyAsync(startsOn, expiresOn, bounded.Token);
            cached = new CachedKey(key, expiresOn);
            logger.LogInformation(
                "User delegation key acquisition succeeded in {ElapsedMs} ms (reason {Reason}, first {IsFirst}).",
                ElapsedMs(started),
                reason,
                number == 1);
            return key;
        }
        catch (OperationCanceledException) when (bounded.IsCancellationRequested && !lifetime.IsCancellationRequested)
        {
            logger.LogWarning(
                "User delegation key acquisition timed out after {ElapsedMs} ms (limit {TimeoutMs} ms, reason {Reason}, first {IsFirst}).",
                ElapsedMs(started),
                (long)acquisitionTimeout.TotalMilliseconds,
                reason,
                number == 1);
            throw new TimeoutException($"User delegation key acquisition exceeded {acquisitionTimeout.TotalSeconds:0} seconds.");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var requestFailed = exception as RequestFailedException;
            logger.LogWarning(
                "User delegation key acquisition failed after {ElapsedMs} ms: {ExceptionType}, status {Status}, error code {ErrorCode} (reason {Reason}, first {IsFirst}).",
                ElapsedMs(started),
                exception.GetType().Name,
                requestFailed?.Status,
                requestFailed?.ErrorCode,
                reason,
                number == 1);
            throw;
        }
        finally
        {
            // Success or not, this fetch is over: a success is in `cached`, a failure leaves nothing
            // behind, and the next caller that needs a key starts a new fetch.
            lock (gate)
            {
                inFlight = null;
            }
        }
    }

    private bool IsStillValid(CachedKey? snapshot) =>
        snapshot is not null && timeProvider.GetUtcNow() < snapshot.ExpiresOn - RefreshBuffer;

    private static long ElapsedMs(long startedTimestamp) =>
        (long)Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;

    public void Dispose()
    {
        // The app is shutting down: an unfinished fetch stops right away. Only cancelled, never
        // disposed - a straggling caller must still be able to read its (cancelled) token.
        lifetime.Cancel();
    }

    private sealed record CachedKey(UserDelegationKey Key, DateTimeOffset ExpiresOn);
}

using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Juple.Infrastructure.Images;

/// <summary>
/// Caches the Production User Delegation Key across requests (registered as a Singleton) so a
/// per-Blob read URL can be signed without a network round trip to Azure AD/Storage on every
/// call - the key itself can sign any number of SAS tokens for its whole validity window. Not
/// used on the Azurite/local path, which signs directly with a Shared Key credential instead.
/// </summary>
public sealed class UserDelegationKeyCache(BlobServiceClient blobServiceClient)
{
    private static readonly TimeSpan KeyValidity = TimeSpan.FromHours(1);

    // Must stay comfortably above ItemImageStore.ReadUrlTtl (currently 15 minutes): Azure rejects
    // a SAS whose ExpiresOn is later than the User Delegation Key that signed it, so a key must
    // never be handed out with less remaining validity than the longest SAS it could be asked to
    // sign - otherwise the very last read URLs signed before a refresh would be born already
    // rejected by Storage.
    private static readonly TimeSpan RefreshBuffer = TimeSpan.FromMinutes(20);

    private readonly SemaphoreSlim refreshLock = new(1, 1);

    // A single immutable snapshot rather than two separate fields: the unsynchronized read on the
    // fast path below must never be able to observe a torn combination of one refresh's Key with
    // another refresh's ExpiresOn - reading one reference is atomic, reading two fields is not.
    private CachedKey? cached;

    public async Task<UserDelegationKey> GetOrRefreshAsync(CancellationToken cancellationToken)
    {
        var snapshot = cached;
        if (IsStillValid(snapshot))
        {
            return snapshot!.Key;
        }

        await refreshLock.WaitAsync(cancellationToken);
        try
        {
            snapshot = cached;
            if (IsStillValid(snapshot))
            {
                return snapshot!.Key;
            }

            var startsOn = DateTimeOffset.UtcNow;
            var expiresOn = startsOn.Add(KeyValidity);
            var key = await blobServiceClient.GetUserDelegationKeyAsync(startsOn, expiresOn, cancellationToken);
            cached = new CachedKey(key, expiresOn);
            return key;
        }
        finally
        {
            refreshLock.Release();
        }
    }

    private static bool IsStillValid(CachedKey? snapshot) =>
        snapshot is not null && DateTimeOffset.UtcNow < snapshot.ExpiresOn - RefreshBuffer;

    private sealed record CachedKey(UserDelegationKey Key, DateTimeOffset ExpiresOn);
}

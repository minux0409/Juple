using Azure;
using Azure.Storage.Blobs.Models;
using Juple.Infrastructure.Images;
using Microsoft.Extensions.Logging;

namespace Juple.UnitTests.Images;

/// <summary>
/// Read URLs on the Managed Identity path (a User Delegation Key signs them - the Azurite/Shared
/// Key path is covered by ItemImageStoreIntegrationTests): every kind of photo keeps getting its
/// read-only HTTPS URL from the one shared key, an aborted request is not a warning, and a real
/// failure is - without the Blob path, the URL or anything secret in the log.
/// </summary>
public sealed class ItemImageStoreReadUrlTests
{
    private const long UserId = 2;
    private const string ItemBlob = "items/2/5/0f3c2a.jpg";
    private const string CollectionIconBlob = "items/2/collections/71/bf1351.jpg";
    private const string ProfileBlob = "items/2/profile/9a7e11.jpg";

    private readonly FakeBlobServiceClient storage = new();
    private readonly ListLogger<ItemImageStore> logger = new();

    private ItemImageStore Store(UserDelegationKeyCache cache) =>
        // No database access on the read-URL path.
        new(null!, storage, storage.GetBlobContainerClient("item-images"), cache, logger);

    [Fact]
    public async Task ItemCollectionIconAndProfilePhotos_AllGetReadOnlyHttpsUrls_FromOneSharedKey()
    {
        var store = Store(new UserDelegationKeyCache(storage));

        var item = await store.CreateReadUrlAsync(UserId, ItemBlob);
        var icon = await store.CreateCollectionIconReadUrlAsync(UserId, CollectionIconBlob);
        var profile = await store.CreateProfileImageReadUrlAsync(UserId, ProfileBlob);

        foreach (var (url, blob) in new[] { (item, ItemBlob), (icon, CollectionIconBlob), (profile, ProfileBlob) })
        {
            Assert.NotNull(url);
            Assert.EndsWith($"/item-images/{blob}", url!.GetLeftPart(UriPartial.Path), StringComparison.Ordinal);
            Assert.Contains("sp=r", url.Query, StringComparison.Ordinal);
            Assert.Contains("spr=https", url.Query, StringComparison.Ordinal);
            Assert.Contains("sig=", url.Query, StringComparison.Ordinal);
        }

        Assert.Equal(1, storage.Calls);
        Assert.DoesNotContain(logger.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    [Fact]
    public async Task ARequestAbortedWhileTheKeyIsFetched_IsNoWarning_AndTheFetchStillServesTheNextRequest()
    {
        var gate = new TaskCompletionSource<UserDelegationKey>(TaskCreationOptions.RunContinuationsAsynchronously);
        storage.Acquire = _ => gate.Task;
        var store = Store(new UserDelegationKeyCache(storage));
        using var aborted = new CancellationTokenSource();

        // A Collections page with four icons, and the app giving up after 8 seconds.
        var firstPage = Task.WhenAll(Enumerable.Range(0, 4).Select(i => store.CreateCollectionIconReadUrlAsync(UserId, $"items/2/collections/{70 + i}/a.jpg", aborted.Token)));
        await UserDelegationKeyCacheTests.WaitUntilAsync(() => storage.Calls == 1);
        aborted.Cancel();

        Assert.All(await firstPage, Assert.Null);
        Assert.DoesNotContain(logger.Entries, entry => entry.Level >= LogLevel.Warning);

        gate.SetResult(FakeBlobServiceClient.NewKey());
        Assert.NotNull(await store.CreateCollectionIconReadUrlAsync(UserId, CollectionIconBlob));
        Assert.Equal(1, storage.Calls);
    }

    [Fact]
    public async Task ARealStorageFailure_IsAStructuredWarning_WithoutThePathTheUrlOrAnySecret()
    {
        storage.Acquire = _ => Task.FromException<UserDelegationKey>(
            new RequestFailedException(403, "This request is not authorized to perform this operation.", "AuthorizationPermissionMismatch", null));
        var store = Store(new UserDelegationKeyCache(storage));

        Assert.Null(await store.CreateCollectionIconReadUrlAsync(UserId, CollectionIconBlob));

        var warning = Assert.Single(logger.Entries, entry => entry.Level == LogLevel.Warning);
        Assert.Contains("Failed to create a read URL (collectionIcon, stage DelegationKey)", warning.Message, StringComparison.Ordinal);
        Assert.Contains("status 403", warning.Message, StringComparison.Ordinal);
        Assert.Contains("AuthorizationPermissionMismatch", warning.Message, StringComparison.Ordinal);
        foreach (var leak in new[] { "items/2", "collections/71", "sig=", "?sv=", "https://", "not-a-real-token", "Authorization:" })
        {
            Assert.DoesNotContain(leak, warning.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ATimedOutKeyFetch_WhileTheRequestIsAlive_IsAWarning_NotMistakenForAnAbort()
    {
        storage.Acquire = async token =>
        {
            await Task.Delay(Timeout.Infinite, token);
            return FakeBlobServiceClient.NewKey();
        };
        var store = Store(new UserDelegationKeyCache(storage, acquisitionTimeout: TimeSpan.FromMilliseconds(100)));

        Assert.Null(await store.CreateReadUrlAsync(UserId, ItemBlob));

        var warning = Assert.Single(logger.Entries, entry => entry.Level == LogLevel.Warning);
        Assert.Contains("(itemImage, stage DelegationKey): TimeoutException", warning.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ABlobOutsideTheCallersPrefix_IsNeverSigned()
    {
        var store = Store(new UserDelegationKeyCache(storage));

        await Assert.ThrowsAsync<InvalidOperationException>(() => store.CreateReadUrlAsync(UserId, "items/3/5/x.jpg"));
        Assert.Null(await store.CreateCollectionIconReadUrlAsync(UserId, "items/3/collections/1/x.jpg"));
        Assert.Equal(0, storage.Calls);
    }
}

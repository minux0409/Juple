using Azure.Storage.Blobs;
using Juple.Application.Images;
using Juple.Application.Images.UploadItemImage;
using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.IntegrationTests.Images;

public sealed class ItemImageStoreIntegrationTests : IAsyncLifetime
{
    private static readonly byte[] JpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46];

    private JupleDbContext _dbContext = null!;
    private BlobContainerClient _blobContainerClient = null!;
    private long _userId;
    private long _otherUserId;
    private long _itemId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item image integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);
        _blobContainerClient = TestBlobContainerClientFactory.Create();

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/item-image-store", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
    }

    public async Task DisposeAsync()
    {
        var blobNames = await _dbContext.ItemImages
            .AsNoTracking()
            .Where(image => image.ItemId == _itemId)
            .Select(image => image.BlobName)
            .ToListAsync();
        foreach (var blobName in blobNames)
        {
            await _blobContainerClient.GetBlobClient(blobName).DeleteIfExistsAsync();
        }

        // Deleting the Item cascades images.ItemImages, so no separate cleanup of that table.
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task UploadAsync_UploadsBlobAndPersistsRow()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        var image = await store.UploadAsync(
            _userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);

        Assert.Equal("image/jpeg", image.ContentType);
        Assert.Equal(JpegBytes.LongLength, image.ByteLength);
        Assert.Equal(0, image.SortOrder);

        var row = await _dbContext.ItemImages.AsNoTracking().SingleAsync(row => row.Id == image.Id);
        Assert.StartsWith($"items/{_userId}/{_itemId}/", row.BlobName);
        Assert.EndsWith(".jpg", row.BlobName);
        Assert.True(await _blobContainerClient.GetBlobClient(row.BlobName).ExistsAsync());
    }

    [Fact]
    public async Task UploadAsync_EndToEndThroughApplicationService_IgnoresClientContentTypeAndDetectsRealFormat()
    {
        // A PNG's real magic bytes, exercising the full Application -> Store -> Blob path - the
        // client never gets a chance to declare a Content-Type/filename in this call shape at all.
        byte[] pngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01];
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var service = new UploadItemImageService(store, TimeProvider.System);

        var image = await service.UploadAsync(_userId, _itemId, pngBytes);

        Assert.Equal("image/png", image.ContentType);
        var row = await _dbContext.ItemImages.AsNoTracking().SingleAsync(row => row.Id == image.Id);
        Assert.EndsWith(".png", row.BlobName);
    }

    [Fact]
    public async Task UploadAsync_SecondImage_IncrementsSortOrder()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        var first = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var second = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);

        Assert.Equal(0, first.SortOrder);
        Assert.Equal(1, second.SortOrder);
    }

    [Fact]
    public async Task UploadAsync_OnAnotherUsersItem_ThrowsItemNotFound()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.UploadAsync(_otherUserId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task UploadAsync_WhenItemAlreadyHas10Images_ThrowsItemImageLimitExceeded()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        for (var i = 0; i < 10; i++)
        {
            await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        }

        await Assert.ThrowsAsync<ItemImageLimitExceededException>(
            () => store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow));

        var count = await _dbContext.ItemImages.CountAsync(image => image.ItemId == _itemId);
        Assert.Equal(10, count);
    }

    [Fact]
    public async Task UploadAsync_WhenDbInsertFails_DeletesTheJustUploadedBlobBestEffort()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        // Deliberately bypasses Application-layer validation (which would reject empty content)
        // to force the DB's CK_ItemImages_ByteLength_Positive check constraint to fail after a
        // real Blob upload has already happened - proving the compensating Blob delete runs.
        await Assert.ThrowsAsync<DbUpdateException>(
            () => store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, [], DateTimeOffset.UtcNow));

        var remainingBlobs = new List<string>();
        await foreach (var blobItem in _blobContainerClient.GetBlobsAsync(
            Azure.Storage.Blobs.Models.BlobTraits.None,
            Azure.Storage.Blobs.Models.BlobStates.None,
            prefix: $"items/{_userId}/{_itemId}/",
            cancellationToken: default))
        {
            remainingBlobs.Add(blobItem.Name);
        }

        Assert.Empty(remainingBlobs);
        Assert.Equal(0, await _dbContext.ItemImages.CountAsync(image => image.ItemId == _itemId));
    }

    [Fact]
    public async Task ListAsync_ReturnsImagesOrderedBySortOrderThenId()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var first = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var second = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);

        var images = await store.ListAsync(_userId, _itemId);

        Assert.Equal([first.Id, second.Id], images.Select(image => image.Id));
    }

    [Fact]
    public async Task ListAsync_OnAnotherUsersItem_ThrowsItemNotFound()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.ListAsync(_otherUserId, _itemId));
    }

    [Fact]
    public async Task DeleteAsync_RemovesRowAndBlob()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var image = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var blobName = (await _dbContext.ItemImages.AsNoTracking().SingleAsync(row => row.Id == image.Id)).BlobName;
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, _itemId, image.Id);

        Assert.Equal(0, await _dbContext.ItemImages.CountAsync(row => row.Id == image.Id));
        Assert.False(await _blobContainerClient.GetBlobClient(blobName).ExistsAsync());
    }

    [Fact]
    public async Task DeleteAsync_WhenImageDoesNotExist_CompletesWithoutException()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        await store.DeleteAsync(_userId, _itemId, imageId: -1);
    }

    [Fact]
    public async Task DeleteAsync_OnAnotherUsersItem_DoesNotDeleteAndCompletesWithoutException()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var image = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_otherUserId, _itemId, image.Id);

        Assert.Equal(1, await _dbContext.ItemImages.CountAsync(row => row.Id == image.Id));
    }

    [Fact]
    public async Task DeleteItemService_DeleteAsync_RemovesImageRowsAndBlobsViaOrchestration()
    {
        // Exercises the Application-orchestration design: ItemStore (Infrastructure) knows
        // nothing about Blob Storage - DeleteItemService deletes the Item via IItemLifecycleStore,
        // then hands userId/itemId to IItemImageStorage, which cleans up by listing the Item's own
        // Blob prefix rather than trusting any pre-delete snapshot of names.
        var imageStore = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var itemStore = new ItemStore(_dbContext);
        var deleteItemService = new DeleteItemService(itemStore, imageStore);

        var firstImage = await imageStore.UploadAsync(
            _userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var secondImage = await imageStore.UploadAsync(
            _userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var blobNames = await _dbContext.ItemImages
            .AsNoTracking()
            .Where(row => row.ItemId == _itemId)
            .Select(row => row.BlobName)
            .ToListAsync();
        _dbContext.ChangeTracker.Clear();

        await deleteItemService.DeleteAsync(_userId, _itemId);

        Assert.Equal(0, await _dbContext.ItemImages.CountAsync(
            row => row.Id == firstImage.Id || row.Id == secondImage.Id));
        foreach (var blobName in blobNames)
        {
            Assert.False(await _blobContainerClient.GetBlobClient(blobName).ExistsAsync());
        }
    }

    [Fact]
    public async Task DeleteItemService_DeleteAsync_OnAnotherUsersItem_DeletesNothing()
    {
        // DeleteItemBlobsAsync is scoped to the CALLER's own userId/itemId prefix
        // ("items/{otherUserId}/{itemId}/") - since the real Blob lives under
        // "items/{userId}/{itemId}/", a call with the wrong userId can never reach it, with no
        // separate ownership check needed to guarantee that.
        var imageStore = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var itemStore = new ItemStore(_dbContext);
        var deleteItemService = new DeleteItemService(itemStore, imageStore);

        var image = await imageStore.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var blobName = (await _dbContext.ItemImages.AsNoTracking().SingleAsync(row => row.Id == image.Id)).BlobName;
        _dbContext.ChangeTracker.Clear();

        await deleteItemService.DeleteAsync(_otherUserId, _itemId);

        Assert.Equal(1, await _dbContext.ItemImages.CountAsync(row => row.Id == image.Id));
        Assert.True(await _blobContainerClient.GetBlobClient(blobName).ExistsAsync());
    }

    [Fact]
    public async Task DeleteItemService_DeleteAsync_RemovesOrphanBlobsUnderTheItemPrefixWithNoDbRow()
    {
        // Deterministic reproduction of the race this fix targets: a Blob can exist under the
        // Item's prefix with no corresponding ItemImages row (e.g. an upload whose DB insert
        // hadn't committed yet when a snapshot was taken). Prefix-based cleanup must remove it
        // even though no DB row ever pointed at it.
        var imageStore = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var itemStore = new ItemStore(_dbContext);
        var deleteItemService = new DeleteItemService(itemStore, imageStore);

        var trackedImage = await imageStore.UploadAsync(
            _userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var trackedBlobName =
            (await _dbContext.ItemImages.AsNoTracking().SingleAsync(row => row.Id == trackedImage.Id)).BlobName;

        var orphanBlobName = $"items/{_userId}/{_itemId}/{Guid.NewGuid():N}.jpg";
        await _blobContainerClient.GetBlobClient(orphanBlobName).UploadAsync(new MemoryStream(JpegBytes));
        _dbContext.ChangeTracker.Clear();

        await deleteItemService.DeleteAsync(_userId, _itemId);

        Assert.Equal(0, await _dbContext.ItemImages.CountAsync(row => row.ItemId == _itemId));
        Assert.False(await _blobContainerClient.GetBlobClient(trackedBlobName).ExistsAsync());
        Assert.False(await _blobContainerClient.GetBlobClient(orphanBlobName).ExistsAsync());
    }

    [Fact]
    public async Task DeleteItemBlobsAsync_WhenBlobEnumerationItselfFails_CompletesWithoutThrowing()
    {
        // A real, deterministic Storage-side failure (not a mock): a BlobContainerClient pointed
        // at a container that was never created, so GetBlobsAsync's own listing call - not just an
        // individual Blob delete, already covered by DeleteBlobBestEffortAsync's own try/catch -
        // fails. This must not propagate: the caller (DeleteItemService, and ultimately DELETE
        // /items/{id}) must never fail just because best-effort cleanup couldn't even start.
        var missingContainerClient = TestBlobContainerClientFactory.CreateForMissingContainer();
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, missingContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        await store.DeleteItemBlobsAsync(_userId, _itemId);
    }

    [Fact]
    public async Task DeleteItemService_DeleteAsync_WhenBlobEnumerationFails_StillDeletesTheDbRowSuccessfully()
    {
        // End-to-end version of the enumeration-failure guard above: the DB Item delete must
        // succeed and DeleteItemService.DeleteAsync must not throw, even though the Blob cleanup
        // step it triggers afterward cannot reach Storage at all.
        var missingContainerClient = TestBlobContainerClientFactory.CreateForMissingContainer();
        var imageStore = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, missingContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var itemStore = new ItemStore(_dbContext);
        var deleteItemService = new DeleteItemService(itemStore, imageStore);

        await deleteItemService.DeleteAsync(_userId, _itemId);

        Assert.False(await _dbContext.Items.AsNoTracking().AnyAsync(item => item.Id == _itemId));
    }

    [Fact]
    public async Task DeleteItemService_ConcurrentWithUpload_LeavesNoOrphanBlobUnderThePrefix()
    {
        // The exact race this fix targets: an upload and an Item delete running truly
        // concurrently against the same Item. Whichever wins, no Blob may survive under the
        // Item's prefix once both operations have completed - a BlobName snapshot taken before
        // the delete could otherwise miss a Blob the concurrent upload commits afterward.
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")!;
        await using var uploadDbContext = new JupleDbContext(
            new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        await using var deleteDbContext = new JupleDbContext(
            new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        var uploadStore = new ItemImageStore(uploadDbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var deleteImageStore = new ItemImageStore(deleteDbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var deleteItemStore = new ItemStore(deleteDbContext);
        var deleteItemService = new DeleteItemService(deleteItemStore, deleteImageStore);

        var uploadTask = uploadStore.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var deleteTask = deleteItemService.DeleteAsync(_userId, _itemId);

        // The upload racing a concurrent Item delete has three legitimate outcomes: it succeeds
        // (delete runs after); it throws ItemNotFoundException (the Item was already gone by its
        // initial ownership check); or - since that check and the final locked insert are not
        // atomic across the Blob upload in between - the Item can disappear in that window, so the
        // insert itself fails on the ItemImages -> Item foreign key (DbUpdateException). All three
        // leave a consistent final state, since a failed insert still runs its own compensating
        // Blob delete and a successful insert's Blob is still visible to the delete's prefix scan.
        Exception? uploadOutcome = null;
        try
        {
            await uploadTask;
        }
        catch (Exception exception)
        {
            uploadOutcome = exception;
        }
        await deleteTask;
        if (uploadOutcome is not null and not ItemNotFoundException and not DbUpdateException)
        {
            throw uploadOutcome;
        }

        Assert.Equal(0, await _dbContext.ItemImages.CountAsync(row => row.ItemId == _itemId));

        var remainingBlobs = new List<string>();
        await foreach (var blobItem in _blobContainerClient.GetBlobsAsync(
            Azure.Storage.Blobs.Models.BlobTraits.None,
            Azure.Storage.Blobs.Models.BlobStates.None,
            prefix: $"items/{_userId}/{_itemId}/",
            cancellationToken: default))
        {
            remainingBlobs.Add(blobItem.Name);
        }

        Assert.Empty(remainingBlobs);
    }

    [Fact]
    public async Task UploadAsync_TwoConcurrentUploadsAtCap_AllowsExactlyTenAndCompensatesTheRejectedBlob()
    {
        for (var i = 0; i < 9; i++)
        {
            var seedStore = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
            await seedStore.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        }
        _dbContext.ChangeTracker.Clear();

        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")!;
        await using var dbContextA = new JupleDbContext(
            new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        await using var dbContextB = new JupleDbContext(
            new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        var storeA = new ItemImageStore(dbContextA, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);
        var storeB = new ItemImageStore(dbContextB, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        var uploadA = storeA.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var uploadB = storeB.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);

        var results = await Task.WhenAll(
            uploadA.ContinueWith(t => t.Exception?.InnerException),
            uploadB.ContinueWith(t => t.Exception?.InnerException));

        // Exactly one of the two truly-concurrent uploads must be rejected by the cap - never
        // both accepted (11 rows) and never both rejected (9 rows stuck).
        var rejections = results.Count(exception => exception is ItemImageLimitExceededException);
        Assert.Equal(1, rejections);

        var finalRows = await _dbContext.ItemImages
            .AsNoTracking()
            .Where(row => row.ItemId == _itemId)
            .ToListAsync();
        Assert.Equal(10, finalRows.Count);
        Assert.Equal(10, finalRows.Select(row => row.SortOrder).Distinct().Count());

        var remainingBlobs = new List<string>();
        await foreach (var blobItem in _blobContainerClient.GetBlobsAsync(
            Azure.Storage.Blobs.Models.BlobTraits.None,
            Azure.Storage.Blobs.Models.BlobStates.None,
            prefix: $"items/{_userId}/{_itemId}/",
            cancellationToken: default))
        {
            remainingBlobs.Add(blobItem.Name);
        }

        // The rejected request's just-uploaded Blob must have been compensation-deleted - exactly
        // the 10 Blobs backing the 10 persisted rows, no orphan from the losing request.
        Assert.Equal(10, remainingBlobs.Count);
        Assert.Equal(
            finalRows.Select(row => row.BlobName).OrderBy(name => name),
            remainingBlobs.OrderBy(name => name));
    }

    [Fact]
    public async Task DeleteBlobsByPrefixAsync_RemovesEveryBlobAcrossAllOfTheUsersItems_AndLeavesOtherUsersBlobsIntact()
    {
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, _blobContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        // A second Item for the same user, so this proves the cleanup reaches every Item under
        // the user's prefix - not just the one Item DeleteItemBlobsAsync would have been scoped to.
        var secondItem = new Item(_userId, "https://shop.example/account-deletion-second-item", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(secondItem);
        var otherUserItem = new Item(_otherUserId, "https://shop.example/other-user-item", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(otherUserItem);
        await _dbContext.SaveChangesAsync();

        var firstImage = await store.UploadAsync(_userId, _itemId, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var secondImage = await store.UploadAsync(_userId, secondItem.Id, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var otherUserImage = await store.UploadAsync(_otherUserId, otherUserItem.Id, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var blobNamesById = await _dbContext.ItemImages
            .AsNoTracking()
            .Where(row => row.Id == firstImage.Id || row.Id == secondImage.Id || row.Id == otherUserImage.Id)
            .ToDictionaryAsync(row => row.Id, row => row.BlobName);
        _dbContext.ChangeTracker.Clear();

        try
        {
            var succeeded = await store.DeleteBlobsByPrefixAsync(store.GetUserBlobPrefix(_userId));

            Assert.True(succeeded);
            Assert.False(await _blobContainerClient.GetBlobClient(blobNamesById[firstImage.Id]).ExistsAsync());
            Assert.False(await _blobContainerClient.GetBlobClient(blobNamesById[secondImage.Id]).ExistsAsync());
            Assert.True(await _blobContainerClient.GetBlobClient(blobNamesById[otherUserImage.Id]).ExistsAsync());
        }
        finally
        {
            await _blobContainerClient.GetBlobClient(blobNamesById[otherUserImage.Id]).DeleteIfExistsAsync();
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM items.Items WHERE Id = {secondItem.Id} OR Id = {otherUserItem.Id}");
        }
    }

    [Fact]
    public async Task DeleteBlobsByPrefixAsync_WhenBlobEnumerationItselfFails_CompletesWithoutThrowingAndReportsFailure()
    {
        // Same rationale as DeleteItemBlobsAsync's own enumeration-failure test - a Storage-side
        // failure to even list the prefix must never propagate, since this always runs after the
        // caller's own SQL deletion has already committed. Unlike DeleteItemBlobsAsync, this
        // method also reports the failure back via its return value (see IBlobCleanupService,
        // which relies on it to know whether a retry is needed).
        var missingContainerClient = TestBlobContainerClientFactory.CreateForMissingContainer();
        var store = new ItemImageStore(_dbContext, TestBlobContainerClientFactory.Service, missingContainerClient, TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        var succeeded = await store.DeleteBlobsByPrefixAsync(store.GetUserBlobPrefix(_userId));

        Assert.False(succeeded);
    }
}

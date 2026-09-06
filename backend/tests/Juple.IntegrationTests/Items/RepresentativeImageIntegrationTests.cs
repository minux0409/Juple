using System.Data.Common;
using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Specialized;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemHistory;
using Juple.Domain.Users;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.IntegrationTests.Items;

public sealed class RepresentativeImageIntegrationTests : IAsyncLifetime
{
    private static readonly byte[] JpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46];

    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private BlobContainerClient _blobContainerClient = null!;
    private ItemImageStore _imageStore = null!;
    private ItemStore _itemStore = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run representative image integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);
        _blobContainerClient = TestBlobContainerClientFactory.Create();
        _imageStore = new ItemImageStore(
            _dbContext,
            TestBlobContainerClientFactory.Service,
            _blobContainerClient,
            TestBlobContainerClientFactory.CreateUserDelegationKeyCache(),
            NullLogger<ItemImageStore>.Instance);
        _itemStore = new ItemStore(_dbContext);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;
    }

    public async Task DisposeAsync()
    {
        // Scoped to this test class's own Items only - querying ItemImages unfiltered would
        // delete Blobs belonging to other test classes' data running concurrently against the
        // same shared Azurite container and SQL Server database.
        var blobNames = await _dbContext.ItemImages
            .AsNoTracking()
            .Where(image => _dbContext.Items
                .Where(item => item.UserId == _userId || item.UserId == _otherUserId)
                .Select(item => item.Id)
                .Contains(image.ItemId))
            .Select(image => image.BlobName)
            .ToListAsync();
        foreach (var blobName in blobNames)
        {
            await _blobContainerClient.GetBlobClient(blobName).DeleteIfExistsAsync();
        }

        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task ListAsync_ReadUrl_DownloadsTheActualBlobContent()
    {
        var item = await SaveItemAsync();
        var image = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);

        var images = await _imageStore.ListAsync(_userId, item);

        Assert.NotNull(images[0].ReadUrl);
        using var httpClient = new HttpClient();
        var response = await httpClient.GetAsync(images[0].ReadUrl);
        response.EnsureSuccessStatusCode();
        var downloadedBytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal(JpegBytes, downloadedBytes);
        Assert.Equal(image.Id, images[0].Id);
    }

    [Fact]
    public async Task CreateReadUrlAsync_ReadUrl_CannotBeUsedToWriteOrDelete()
    {
        var item = await SaveItemAsync();
        var image = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var readUrl = image.ReadUrl!;

        var blobClientFromReadUrl = new BlobClient(readUrl);

        await Assert.ThrowsAsync<RequestFailedException>(
            () => blobClientFromReadUrl.UploadAsync(new MemoryStream(JpegBytes), overwrite: true));
        await Assert.ThrowsAsync<RequestFailedException>(
            () => blobClientFromReadUrl.DeleteAsync());

        // The permission failures above must not have actually deleted/overwritten anything.
        Assert.True(await _blobContainerClient.GetBlobClient(BlobNameFrom(readUrl)).ExistsAsync());
    }

    [Fact]
    public async Task CreateReadUrlAsync_ForBlobNameOutsideCallersOwnPrefix_ThrowsRatherThanSigning()
    {
        var item = await SaveItemAsync();
        var image = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var row = await _dbContext.ItemImages.AsNoTracking().SingleAsync(row => row.Id == image.Id);

        // otherUserId requesting a read URL for a Blob that lives under userId's own prefix must
        // never succeed, regardless of what BlobName string is passed in.
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _imageStore.CreateReadUrlAsync(_otherUserId, row.BlobName));
    }

    [Fact]
    public async Task GetHistoryAsync_RepresentativeImage_IsSortOrderAscIdAscFirst()
    {
        var item = await SaveItemAsync();
        var first = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        var second = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, representativeImages) = await _itemStore.GetHistoryAsync(
            _userId, cursor: null, limit: 50);

        Assert.True(representativeImages.TryGetValue(item, out var reference));
        Assert.Equal(first.Id, reference!.ImageId);
        Assert.NotEqual(second.Id, reference.ImageId);
        Assert.Contains(page.Items, entry => entry.Id == item);
    }

    [Fact]
    public async Task GetHistoryAsync_ItemWithNoImages_HasNoRepresentativeImageEntry()
    {
        var item = await SaveItemAsync();

        var (_, representativeImages) = await _itemStore.GetHistoryAsync(
            _userId, cursor: null, limit: 50);

        Assert.False(representativeImages.ContainsKey(item));
    }

    [Fact]
    public async Task GetHistoryAsync_ResolvedThroughApplicationService_PopulatesReadUrlForRepresentativeImage()
    {
        var item = await SaveItemAsync();
        await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var service = new GetItemHistoryService(_itemStore, _imageStore);
        var page = await service.GetAsync(_userId, cursor: null, limit: 50);

        var entry = Assert.Single(page.Items, entry => entry.Id == item);
        Assert.NotNull(entry.RepresentativeImage);
        Assert.NotNull(entry.RepresentativeImage!.ReadUrl);
    }

    [Fact]
    public async Task GetDetailsAsync_RepresentativeImage_MatchesFirstUploadedImage()
    {
        var item = await SaveItemAsync();
        var first = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (_, representativeImage) = await _itemStore.GetDetailsAsync(_userId, item);

        Assert.NotNull(representativeImage);
        Assert.Equal(first.Id, representativeImage!.ImageId);
    }

    [Fact]
    public async Task GetDetailsAsync_ItemWithNoImages_RepresentativeImageIsNull()
    {
        var item = await SaveItemAsync();

        var (_, representativeImage) = await _itemStore.GetDetailsAsync(_userId, item);

        Assert.Null(representativeImage);
    }

    [Fact]
    public async Task GetHistoryAsync_RepresentativeImage_MatchesFirstUploadedImage()
    {
        var item = await SaveItemAsync();
        var first = await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        await _imageStore.UploadAsync(_userId, item, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (_, representativeImages) = await _itemStore.GetHistoryAsync(
            _userId, cursor: null, limit: 50);

        Assert.True(representativeImages.TryGetValue(item, out var reference));
        Assert.Equal(first.Id, reference!.ImageId);
    }

    [Fact]
    public async Task GetHistoryAsync_QueryingItemsWithImages_ExecutesExactlyOneDbCommand()
    {
        var interceptor = new CountingCommandInterceptor();
        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .AddInterceptors(interceptor)
            .Options;
        await using var countedDbContext = new JupleDbContext(options);
        var countedItemStore = new ItemStore(countedDbContext);
        var countedImageStore = new ItemImageStore(
            countedDbContext,
            TestBlobContainerClientFactory.Service,
            _blobContainerClient,
            TestBlobContainerClientFactory.CreateUserDelegationKeyCache(),
            NullLogger<ItemImageStore>.Instance);

        var itemA = await SaveItemAsync();
        var itemB = await SaveItemAsync();
        var itemC = await SaveItemAsync();
        await _imageStore.UploadAsync(_userId, itemA, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        await _imageStore.UploadAsync(_userId, itemB, ImageFormat.Jpeg, JpegBytes, DateTimeOffset.UtcNow);
        // itemC deliberately has no image, to prove the query handles a mix without extra round trips.
        _dbContext.ChangeTracker.Clear();
        countedDbContext.ChangeTracker.Clear();

        interceptor.ExecutedCommandCount = 0;
        var (page, representativeImages) = await countedItemStore.GetHistoryAsync(
            _userId, cursor: null, limit: 50);

        // One SQL statement for the whole page (the representative image is a correlated
        // subquery/OUTER APPLY inside it) - never one query per Item.
        Assert.Equal(1, interceptor.ExecutedCommandCount);
        Assert.Equal(3, page.Items.Count);
        Assert.Equal(2, representativeImages.Count);
        GC.KeepAlive(countedImageStore);
    }

    private async Task<long> SaveItemAsync()
    {
        var result = await _itemStore.SaveAsync(_userId, $"https://shop.example/{Guid.NewGuid():N}", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }

    private static string BlobNameFrom(Uri readUrl) =>
        // Delegates to the SDK's own URI parser rather than assembling path assumptions by hand -
        // Azurite's path shape (/{account}/{container}/{blob}) differs from real Azure's
        // (/{container}/{blob}), and BlobUriBuilder already knows how to tell them apart.
        new BlobUriBuilder(readUrl).BlobName;

    private sealed class CountingCommandInterceptor : DbCommandInterceptor
    {
        public int ExecutedCommandCount { get; set; }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            ExecutedCommandCount++;
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            ExecutedCommandCount++;
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}

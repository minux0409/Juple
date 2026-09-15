using Juple.Application.Items;
using Juple.Domain.Images;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// Deliberately seeds ItemImage rows directly via EF rather than through ItemImageStore.UploadAsync -
/// what's under test here is CoverImageId's DB-level ownership/clearing semantics, not Blob upload
/// mechanics, so these never need a real Blob Storage/Azurite endpoint at all (see
/// ItemImageStoreIntegrationTests for the Blob-backed delete-clears-cover coverage instead).
/// </summary>
public sealed class SetItemCoverImageIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _itemId;
    private long _otherItemId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run cover image integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;

        var itemStore = new ItemStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cover-image-a", null, DateTimeOffset.UtcNow);
        _itemId = saved.Entry.Id;
        var otherSaved = await itemStore.SaveAsync(_userId, "https://shop.example/cover-image-b", null, DateTimeOffset.UtcNow);
        _otherItemId = otherSaved.Entry.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    private async Task<long> SeedImageAsync(long itemId)
    {
        var image = new ItemImage(itemId, $"items/{_userId}/{itemId}/{Guid.NewGuid():N}.jpg", "image/jpeg", 10, 0, DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(image);
        await _dbContext.SaveChangesAsync();
        var id = image.Id;
        _dbContext.ChangeTracker.Clear();
        return id;
    }

    [Fact]
    public async Task SetCoverImageIdAsync_ToOwnUploadedImage_PersistsAndGetDetailsReturnsIt()
    {
        var itemStore = new ItemStore(_dbContext);
        var imageId = await SeedImageAsync(_itemId);

        await itemStore.SetCoverImageIdAsync(_userId, _itemId, imageId);
        _dbContext.ChangeTracker.Clear();

        var (_, _, coverReference) = await itemStore.GetDetailsAsync(_userId, _itemId);

        Assert.NotNull(coverReference);
        Assert.Equal(imageId, coverReference.ImageId);
    }

    [Fact]
    public async Task SetCoverImageIdAsync_ToImageBelongingToAnotherItem_ThrowsInvalidItemDetails()
    {
        var itemStore = new ItemStore(_dbContext);
        var imageOnOtherItem = await SeedImageAsync(_otherItemId);

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => itemStore.SetCoverImageIdAsync(_userId, _itemId, imageOnOtherItem));

        Assert.Equal("imageId", exception.Field);

        var (_, _, coverReference) = await itemStore.GetDetailsAsync(_userId, _itemId);
        Assert.Null(coverReference);
    }

    [Fact]
    public async Task SetCoverImageIdAsync_ToNonExistentImageId_ThrowsInvalidItemDetails()
    {
        var itemStore = new ItemStore(_dbContext);

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => itemStore.SetCoverImageIdAsync(_userId, _itemId, imageId: -1));

        Assert.Equal("imageId", exception.Field);
    }

    [Fact]
    public async Task SetCoverImageIdAsync_ThenClearWithNull_RemovesCoverImage()
    {
        var itemStore = new ItemStore(_dbContext);
        var imageId = await SeedImageAsync(_itemId);
        await itemStore.SetCoverImageIdAsync(_userId, _itemId, imageId);
        _dbContext.ChangeTracker.Clear();

        await itemStore.SetCoverImageIdAsync(_userId, _itemId, null);
        _dbContext.ChangeTracker.Clear();

        var (_, _, coverReference) = await itemStore.GetDetailsAsync(_userId, _itemId);
        Assert.Null(coverReference);
    }

    [Fact]
    public async Task SetCoverImageIdAsync_OnItemNotOwnedByUser_ThrowsItemNotFound()
    {
        var itemStore = new ItemStore(_dbContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => itemStore.SetCoverImageIdAsync(userId: _userId + 999, _itemId, imageId: null));
    }

    [Fact]
    public async Task GetDetailsAsync_CoverImageAndRepresentativeImage_ResolveIndependently()
    {
        var itemStore = new ItemStore(_dbContext);
        var firstImageId = await SeedImageAsync(_itemId); // SortOrder 0 - the plain "representative" fallback.
        var secondImageId = await SeedImageAsync(_itemId); // Explicit cover choice below.
        await itemStore.SetCoverImageIdAsync(_userId, _itemId, secondImageId);
        _dbContext.ChangeTracker.Clear();

        var (_, representativeReference, coverReference) = await itemStore.GetDetailsAsync(_userId, _itemId);

        Assert.NotNull(representativeReference);
        Assert.Equal(firstImageId, representativeReference.ImageId);
        Assert.NotNull(coverReference);
        Assert.Equal(secondImageId, coverReference.ImageId);
    }
}

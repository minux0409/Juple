using Juple.Domain.Images;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Images;

public sealed class ItemImageIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
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

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;

        var item = new Item(_userId, "https://shop.example/item-image-item", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
    }

    public async Task DisposeAsync()
    {
        // Deleting the Item cascades images.ItemImages, so no separate cleanup of that table is
        // needed here.
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task ItemImage_Persists_WithAllFields()
    {
        var createdAtUtc = DateTimeOffset.UtcNow;
        var image = new ItemImage(
            _itemId, "items/persist/blob-1.jpg", "image/jpeg", 12_345, sortOrder: 0, createdAtUtc);
        _dbContext.ItemImages.Add(image);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.ItemImages.AsNoTracking()
            .SingleAsync(itemImage => itemImage.Id == image.Id);

        Assert.Equal(_itemId, reloaded.ItemId);
        Assert.Equal("items/persist/blob-1.jpg", reloaded.BlobName);
        Assert.Equal("image/jpeg", reloaded.ContentType);
        Assert.Equal(12_345, reloaded.ByteLength);
        Assert.Equal(0, reloaded.SortOrder);
        Assert.Equal(createdAtUtc, reloaded.CreatedAtUtc);
    }

    [Fact]
    public async Task ItemImage_WithUnknownItemId_ViolatesForeignKey()
    {
        var image = new ItemImage(
            itemId: -1, "items/fk-violation/blob.jpg", "image/jpeg", 1_000, sortOrder: 0,
            DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(image);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task DeletingItem_CascadesDeleteOfItemImages()
    {
        var item = new Item(_userId, "https://shop.example/item-image-cascade", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();

        _dbContext.ItemImages.AddRange(
            new ItemImage(item.Id, "items/cascade/blob-1.jpg", "image/jpeg", 1_000, 0, DateTimeOffset.UtcNow),
            new ItemImage(item.Id, "items/cascade/blob-2.jpg", "image/jpeg", 1_000, 1, DateTimeOffset.UtcNow));
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        _dbContext.Items.Remove(await _dbContext.Items.SingleAsync(i => i.Id == item.Id));
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var remainingImages = await _dbContext.ItemImages.AsNoTracking()
            .Where(itemImage => itemImage.ItemId == item.Id)
            .ToListAsync();
        Assert.Empty(remainingImages);
    }

    [Fact]
    public async Task RepresentativeImage_OrderedBySortOrderThenId_IsDeterministic()
    {
        // Inserted out of SortOrder order, and with a tie (two images at SortOrder 0), to prove
        // "ORDER BY SortOrder ASC, Id ASC" - not insertion order - decides the representative.
        var second = new ItemImage(
            _itemId, "items/order/blob-sort1.jpg", "image/jpeg", 1_000, sortOrder: 1, DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(second);
        await _dbContext.SaveChangesAsync();

        var tieOlder = new ItemImage(
            _itemId, "items/order/blob-sort0-a.jpg", "image/jpeg", 1_000, sortOrder: 0, DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(tieOlder);
        await _dbContext.SaveChangesAsync();

        var tieNewer = new ItemImage(
            _itemId, "items/order/blob-sort0-b.jpg", "image/jpeg", 1_000, sortOrder: 0, DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(tieNewer);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var representative = await _dbContext.ItemImages.AsNoTracking()
            .Where(itemImage => itemImage.ItemId == _itemId)
            .OrderBy(itemImage => itemImage.SortOrder)
            .ThenBy(itemImage => itemImage.Id)
            .FirstAsync();

        Assert.Equal(tieOlder.Id, representative.Id);
        Assert.Equal("items/order/blob-sort0-a.jpg", representative.BlobName);
    }

    [Fact]
    public async Task BlobName_Duplicate_ViolatesUniqueIndex()
    {
        var first = new ItemImage(
            _itemId, "items/duplicate/same-blob.jpg", "image/jpeg", 1_000, 0, DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(first);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var duplicate = new ItemImage(
            _itemId, "items/duplicate/same-blob.jpg", "image/jpeg", 2_000, 1, DateTimeOffset.UtcNow);
        _dbContext.ItemImages.Add(duplicate);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }
}

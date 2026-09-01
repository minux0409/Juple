using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class ItemDetailQueryIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item detail query integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task GetDetailsAsync_WhenTitleAndMemoAreNull_ReturnsNulls()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/detail-a", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var details = await store.GetDetailsAsync(_userId, saved.Entry.Id);

        Assert.NotNull(details);
        Assert.Null(details.Title);
        Assert.Null(details.Memo);
        Assert.Equal(saved.Entry.Url, details.Url);
        Assert.Equal(ItemState.Inbox, details.State);
    }

    [Fact]
    public async Task GetDetailsAsync_WhenTitleAndMemoAreSet_ReturnsThem()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/detail-b", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();

        var details = await store.GetDetailsAsync(_userId, saved.Entry.Id);

        Assert.NotNull(details);
        Assert.Equal("My Title", details.Title);
        Assert.Equal("My memo", details.Memo);
    }

    [Fact]
    public async Task GetDetailsAsync_WhenItemIsInInbox_ReturnsInboxState()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/detail-c", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var details = await store.GetDetailsAsync(_userId, saved.Entry.Id);

        Assert.Equal(ItemState.Inbox, details!.State);
    }

    [Fact]
    public async Task GetDetailsAsync_WhenItemIsInWishlist_ReturnsWishlistState()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/detail-d", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.MoveToWishlistAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var details = await store.GetDetailsAsync(_userId, saved.Entry.Id);

        Assert.Equal(ItemState.Wishlist, details!.State);
    }

    [Fact]
    public async Task GetDetailsAsync_WhenItemIsArchived_ReturnsArchivedState()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/detail-e", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.MoveToArchiveAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var details = await store.GetDetailsAsync(_userId, saved.Entry.Id);

        Assert.Equal(ItemState.Archived, details!.State);
    }

    [Fact]
    public async Task GetDetailsAsync_WhenItemDoesNotExist_ReturnsNull()
    {
        var store = new ItemStore(_dbContext);

        var details = await store.GetDetailsAsync(_userId, itemId: -1);

        Assert.Null(details);
    }

    [Fact]
    public async Task GetDetailsAsync_WhenItemBelongsToAnotherUser_ReturnsNull()
    {
        var store = new ItemStore(_dbContext);
        var ownersItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/detail-f", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var details = await store.GetDetailsAsync(_userId, ownersItem.Entry.Id);

        Assert.Null(details);
    }
}

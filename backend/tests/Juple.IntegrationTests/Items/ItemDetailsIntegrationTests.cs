using Juple.Application.Items;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class ItemDetailsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item details integration tests " +
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
            $"DELETE FROM items.ItemSaveRequests WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task SaveAsync_NewItem_HasNullTitleAndMemo()
    {
        var store = new ItemStore(_dbContext);

        var saved = await store.SaveAsync(_userId, "https://shop.example/details-a", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var item = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Null(item.Title);
        Assert.Null(item.Memo);
    }

    [Fact]
    public async Task UpdateDetailsAsync_PersistsTitleAndMemo()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/details-b", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo\nsecond line");
        _dbContext.ChangeTracker.Clear();

        var item = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Equal("My Title", item.Title);
        Assert.Equal("My memo\nsecond line", item.Memo);
    }

    [Fact]
    public async Task GetDailyAsync_ReflectsUpdatedTitleAndMemo()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/details-c", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();

        var (dailyItems, _) = await store.GetDailyAsync(
            _userId, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));

        var entry = Assert.Single(dailyItems, item => item.Id == saved.Entry.Id);
        Assert.Equal("My Title", entry.Title);
        Assert.Equal("My memo", entry.Memo);
    }

    [Fact]
    public async Task MoveToWishlistAsync_PreservesTitleAndMemo()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/details-d", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();

        await store.MoveToWishlistAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetByStateAsync(_userId, ItemState.Wishlist, categoryId: null, cursor: null, limit: 50);
        var entry = Assert.Single(page.Items, item => item.Id == saved.Entry.Id);
        Assert.Equal("My Title", entry.Title);
        Assert.Equal("My memo", entry.Memo);
    }

    [Fact]
    public async Task MoveToArchiveAsync_PreservesTitleAndMemo()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/details-e", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();

        await store.MoveToArchiveAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetByStateAsync(_userId, ItemState.Archived, categoryId: null, cursor: null, limit: 50);
        var entry = Assert.Single(page.Items, item => item.Id == saved.Entry.Id);
        Assert.Equal("My Title", entry.Title);
        Assert.Equal("My memo", entry.Memo);
    }

    [Fact]
    public async Task DeleteAsync_RemovesItemDetailsButLeavesLedgerUnaffected()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/details-f", clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();
        var ledgerCountBefore = await CountSaveRequestsAsync(clientRequestId);

        await store.DeleteAsync(_userId, saved.Entry.Id);

        Assert.Equal(0, await _dbContext.Items.Where(item => item.Id == saved.Entry.Id).CountAsync());
        Assert.Equal(ledgerCountBefore, await CountSaveRequestsAsync(clientRequestId));
        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));
    }

    [Fact]
    public async Task UpdateDetailsAsync_OnOtherUsersItem_ThrowsItemNotFoundAndLeavesItUnchanged()
    {
        var store = new ItemStore(_dbContext);
        var ownersItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/details-g", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_otherUserId, ownersItem.Entry.Id, "Original Title", "Original memo");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.UpdateDetailsAsync(_userId, ownersItem.Entry.Id, "Attacker Title", "Attacker memo"));

        var item = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == ownersItem.Entry.Id);
        Assert.Equal("Original Title", item.Title);
        Assert.Equal("Original memo", item.Memo);
    }

    [Fact]
    public async Task UpdateDetailsAsync_WithSameValues_DoesNotChangeRowVersion()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/details-h", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();
        var rowVersionAfterFirstUpdate = (await _dbContext.Items
            .AsNoTracking()
            .SingleAsync(item => item.Id == saved.Entry.Id)).RowVersion;

        await store.UpdateDetailsAsync(_userId, saved.Entry.Id, "My Title", "My memo");
        _dbContext.ChangeTracker.Clear();

        var rowVersionAfterNoOpUpdate = (await _dbContext.Items
            .AsNoTracking()
            .SingleAsync(item => item.Id == saved.Entry.Id)).RowVersion;
        Assert.Equal(rowVersionAfterFirstUpdate, rowVersionAfterNoOpUpdate);
    }

    private async Task<int> CountSaveRequestsAsync(Guid clientRequestId) =>
        await _dbContext.ItemSaveRequests
            .Where(request => request.UserId == _userId && request.ClientRequestId == clientRequestId)
            .CountAsync();
}

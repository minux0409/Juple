using Juple.Application.Categories;
using Juple.Application.Items;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Categories;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class ItemCategoryIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item category integration tests " +
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
            $"DELETE FROM categories.Categories WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task AssignCategoryAsync_SetsCategoryAndReflectsInDetailProjection()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-a", null, DateTimeOffset.UtcNow);
        var category = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, category.Id);
        _dbContext.ChangeTracker.Clear();

        var (details, _) = await itemStore.GetDetailsAsync(_userId, saved.Entry.Id);
        Assert.NotNull(details!.Category);
        Assert.Equal(category.Id, details.Category!.Id);
        Assert.Equal("Groceries", details.Category.Name);
    }

    [Fact]
    public async Task AssignCategoryAsync_WithNull_ClearsCategory()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-b", null, DateTimeOffset.UtcNow);
        var category = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();
        await itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, category.Id);
        _dbContext.ChangeTracker.Clear();

        await itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, null);
        _dbContext.ChangeTracker.Clear();

        var (details, _) = await itemStore.GetDetailsAsync(_userId, saved.Entry.Id);
        Assert.Null(details!.Category);
    }

    [Fact]
    public async Task AssignCategoryAsync_WhenItemDoesNotExist_ThrowsItemNotFound()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var category = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => itemStore.AssignCategoryAsync(_userId, itemId: -1, category.Id));
    }

    [Fact]
    public async Task AssignCategoryAsync_WhenCategoryBelongsToAnotherUser_ThrowsCategoryNotFound()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-c", null, DateTimeOffset.UtcNow);
        var othersCategory = await categoryStore.CreateAsync(_otherUserId, "TheirsOnly");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CategoryNotFoundException>(
            () => itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, othersCategory.Id));

        var (details, _) = await itemStore.GetDetailsAsync(_userId, saved.Entry.Id);
        Assert.Null(details!.Category);
    }

    [Fact]
    public async Task AssignCategoryAsync_OnAnotherUsersItem_ThrowsItemNotFound()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var othersItem = await itemStore.SaveAsync(
            _otherUserId, "https://shop.example/cat-d", null, DateTimeOffset.UtcNow);
        var myCategory = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => itemStore.AssignCategoryAsync(_userId, othersItem.Entry.Id, myCategory.Id));
    }

    [Fact]
    public async Task DeleteAsync_OnCategory_SetsAssignedItemsCategoryIdToNullButKeepsItems()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-e", null, DateTimeOffset.UtcNow);
        var category = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();
        await itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, category.Id);
        _dbContext.ChangeTracker.Clear();

        await categoryStore.DeleteAsync(_userId, category.Id);
        _dbContext.ChangeTracker.Clear();

        var item = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Null(item.CategoryId);
    }

    [Fact]
    public async Task GetDailyAsync_ReflectsAssignedCategory()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-f", null, DateTimeOffset.UtcNow);
        var category = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();
        await itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, category.Id);
        _dbContext.ChangeTracker.Clear();

        var (dailyItems, _) = await itemStore.GetDailyAsync(
            _userId, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));

        var entry = Assert.Single(dailyItems, item => item.Id == saved.Entry.Id);
        Assert.NotNull(entry.Category);
        Assert.Equal("Groceries", entry.Category!.Name);
    }

    [Fact]
    public async Task GetDailyAsync_WhenItemHasNoCategory_ReturnsNullCategory()
    {
        var itemStore = new ItemStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-g", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (dailyItems, _) = await itemStore.GetDailyAsync(
            _userId, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));

        var entry = Assert.Single(dailyItems, item => item.Id == saved.Entry.Id);
        Assert.Null(entry.Category);
    }

    [Fact]
    public async Task GetByStateAsync_ReflectsAssignedCategoryAfterWishlistTransition()
    {
        var itemStore = new ItemStore(_dbContext);
        var categoryStore = new CategoryStore(_dbContext);
        var saved = await itemStore.SaveAsync(_userId, "https://shop.example/cat-h", null, DateTimeOffset.UtcNow);
        var category = await categoryStore.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();
        await itemStore.AssignCategoryAsync(_userId, saved.Entry.Id, category.Id);
        _dbContext.ChangeTracker.Clear();

        await itemStore.MoveToWishlistAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await itemStore.GetByStateAsync(
            _userId, ItemState.Wishlist, categoryId: null, cursor: null, limit: 50);
        var entry = Assert.Single(page.Items, item => item.Id == saved.Entry.Id);
        Assert.NotNull(entry.Category);
        Assert.Equal("Groceries", entry.Category!.Name);
    }
}

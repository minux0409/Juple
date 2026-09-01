using Juple.Application.Categories;
using Juple.Domain.Users;
using Juple.Infrastructure.Categories;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Categories;

public sealed class CategoryIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run category integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
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
            $"DELETE FROM categories.Categories WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task CreateAsync_PersistsCategory()
    {
        var store = new CategoryStore(_dbContext);

        var created = await store.CreateAsync(_userId, "Groceries");

        Assert.Equal("Groceries", created.Name);
        Assert.Equal(0, created.SortOrder);
    }

    [Fact]
    public async Task CreateAsync_EachSubsequentCategory_IncrementsSortOrder()
    {
        var store = new CategoryStore(_dbContext);

        var first = await store.CreateAsync(_userId, "Groceries");
        var second = await store.CreateAsync(_userId, "Electronics");
        var third = await store.CreateAsync(_userId, "Books");

        Assert.Equal(0, first.SortOrder);
        Assert.Equal(1, second.SortOrder);
        Assert.Equal(2, third.SortOrder);
    }

    [Fact]
    public async Task ListAsync_ReturnsOrderedBySortOrderThenId()
    {
        var store = new CategoryStore(_dbContext);
        await store.CreateAsync(_userId, "Groceries");
        await store.CreateAsync(_userId, "Electronics");
        await store.CreateAsync(_userId, "Books");

        var categories = await store.ListAsync(_userId);

        Assert.Equal(["Groceries", "Electronics", "Books"], categories.Select(category => category.Name));
    }

    [Fact]
    public async Task ListAsync_ExcludesOtherUsersCategories()
    {
        var store = new CategoryStore(_dbContext);
        await store.CreateAsync(_userId, "Mine");
        await store.CreateAsync(_otherUserId, "TheirsOnly");

        var categories = await store.ListAsync(_userId);

        Assert.Single(categories);
        Assert.Equal("Mine", categories[0].Name);
    }

    [Fact]
    public async Task CreateAsync_WhenNameAlreadyExistsForSameUser_ThrowsCategoryNameConflict()
    {
        var store = new CategoryStore(_dbContext);
        await store.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CategoryNameConflictException>(
            () => store.CreateAsync(_userId, "Groceries"));
    }

    [Fact]
    public async Task CreateAsync_WhenNameDiffersOnlyByCase_ThrowsCategoryNameConflict()
    {
        // Verifies the real DB collation (not a custom normalization) already treats "Food" and
        // "food" as the same name for this unique index.
        var store = new CategoryStore(_dbContext);
        await store.CreateAsync(_userId, "Food");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CategoryNameConflictException>(
            () => store.CreateAsync(_userId, "food"));
    }

    [Fact]
    public async Task CreateAsync_WhenSameNameUsedByDifferentUser_Succeeds()
    {
        var store = new CategoryStore(_dbContext);
        await store.CreateAsync(_otherUserId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        var created = await store.CreateAsync(_userId, "Groceries");

        Assert.Equal("Groceries", created.Name);
    }

    [Fact]
    public async Task RenameAsync_PersistsNewName()
    {
        var store = new CategoryStore(_dbContext);
        var category = await store.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await store.RenameAsync(_userId, category.Id, "Food");
        _dbContext.ChangeTracker.Clear();

        var categories = await store.ListAsync(_userId);
        Assert.Equal("Food", Assert.Single(categories).Name);
    }

    [Fact]
    public async Task RenameAsync_ToAnotherOwnCategorysName_ThrowsCategoryNameConflict()
    {
        var store = new CategoryStore(_dbContext);
        await store.CreateAsync(_userId, "Groceries");
        var second = await store.CreateAsync(_userId, "Electronics");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CategoryNameConflictException>(
            () => store.RenameAsync(_userId, second.Id, "Groceries"));
    }

    [Fact]
    public async Task RenameAsync_WhenCategoryDoesNotExist_ThrowsCategoryNotFound()
    {
        var store = new CategoryStore(_dbContext);

        await Assert.ThrowsAsync<CategoryNotFoundException>(
            () => store.RenameAsync(_userId, categoryId: -1, "Food"));
    }

    [Fact]
    public async Task RenameAsync_OnOtherUsersCategory_ThrowsCategoryNotFound()
    {
        var store = new CategoryStore(_dbContext);
        var ownersCategory = await store.CreateAsync(_otherUserId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CategoryNotFoundException>(
            () => store.RenameAsync(_userId, ownersCategory.Id, "Attacker"));

        var stillOwned = await store.ListAsync(_otherUserId);
        Assert.Equal("Groceries", Assert.Single(stillOwned).Name);
    }

    [Fact]
    public async Task DeleteAsync_RemovesCategory()
    {
        var store = new CategoryStore(_dbContext);
        var category = await store.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, category.Id);

        Assert.Empty(await store.ListAsync(_userId));
    }

    [Fact]
    public async Task DeleteAsync_WhenCategoryDoesNotExist_CompletesWithoutException()
    {
        var store = new CategoryStore(_dbContext);

        await store.DeleteAsync(_userId, categoryId: -1);
    }

    [Fact]
    public async Task DeleteAsync_OnOtherUsersCategory_DoesNotDeleteAndCompletesWithoutException()
    {
        var store = new CategoryStore(_dbContext);
        var ownersCategory = await store.CreateAsync(_otherUserId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, ownersCategory.Id);

        var stillOwned = await store.ListAsync(_otherUserId);
        Assert.Single(stillOwned);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SecondCallCompletesWithoutException()
    {
        var store = new CategoryStore(_dbContext);
        var category = await store.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, category.Id);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, category.Id);
    }

    [Fact]
    public async Task RenameAsync_WhenConcurrentWriteConflicts_ThrowsCategoryConcurrency()
    {
        var store = new CategoryStore(_dbContext);
        var category = await store.CreateAsync(_userId, "Groceries");
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);
        var otherStore = new CategoryStore(otherDbContext);

        // Pre-load into otherDbContext before the concurrent rename below commits, so its tracked
        // RowVersion is stale by the time otherStore.RenameAsync's own internal query returns this
        // same tracked instance instead of a fresh (already-renamed) read.
        await otherDbContext.Categories.FirstAsync(c => c.Id == category.Id);

        var concurrentLoad = await _dbContext.Categories.FirstAsync(c => c.Id == category.Id);
        concurrentLoad.Rename("Food");
        await _dbContext.SaveChangesAsync();

        await Assert.ThrowsAsync<CategoryConcurrencyException>(
            () => otherStore.RenameAsync(_userId, category.Id, "Snacks"));
    }
}

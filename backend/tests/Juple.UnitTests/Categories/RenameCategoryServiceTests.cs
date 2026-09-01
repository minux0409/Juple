using Juple.Application.Categories;
using Juple.Application.Categories.RenameCategory;

namespace Juple.UnitTests.Categories;

public sealed class RenameCategoryServiceTests
{
    [Fact]
    public async Task RenameAsync_TrimsNameOuterWhitespace()
    {
        var store = new FakeCategoryStore();
        var service = new RenameCategoryService(store);

        await service.RenameAsync(17, 41, new RenameCategoryCommand("  Food  "));

        Assert.Equal("Food", store.LastName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task RenameAsync_WhenNameIsMissingOrWhitespaceOnly_ThrowsInvalidCategory(string? name)
    {
        var store = new FakeCategoryStore();
        var service = new RenameCategoryService(store);

        var exception = await Assert.ThrowsAsync<InvalidCategoryException>(
            () => service.RenameAsync(17, 41, new RenameCategoryCommand(name)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasRenameCalled);
    }

    [Fact]
    public async Task RenameAsync_WhenNameExceeds100Characters_ThrowsInvalidCategory()
    {
        var store = new FakeCategoryStore();
        var service = new RenameCategoryService(store);
        var tooLongName = new string('a', 101);

        var exception = await Assert.ThrowsAsync<InvalidCategoryException>(
            () => service.RenameAsync(17, 41, new RenameCategoryCommand(tooLongName)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasRenameCalled);
    }

    [Fact]
    public async Task RenameAsync_CallsStoreWithCurrentUserAndCategoryId()
    {
        var store = new FakeCategoryStore();
        var service = new RenameCategoryService(store);

        await service.RenameAsync(17, 41, new RenameCategoryCommand("Food"));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCategoryId);
    }

    [Fact]
    public async Task RenameAsync_WhenCategoryNotFound_PropagatesCategoryNotFoundException()
    {
        var store = new FakeCategoryStore { ThrowNotFound = true };
        var service = new RenameCategoryService(store);

        await Assert.ThrowsAsync<CategoryNotFoundException>(
            () => service.RenameAsync(17, 41, new RenameCategoryCommand("Food")));
    }

    [Fact]
    public async Task RenameAsync_WhenNameConflicts_PropagatesCategoryNameConflictException()
    {
        var store = new FakeCategoryStore { ThrowNameConflict = true };
        var service = new RenameCategoryService(store);

        await Assert.ThrowsAsync<CategoryNameConflictException>(
            () => service.RenameAsync(17, 41, new RenameCategoryCommand("Food")));
    }

    [Fact]
    public async Task RenameAsync_WhenConcurrentWriteConflicts_PropagatesCategoryConcurrencyException()
    {
        var store = new FakeCategoryStore { ThrowConcurrency = true };
        var service = new RenameCategoryService(store);

        await Assert.ThrowsAsync<CategoryConcurrencyException>(
            () => service.RenameAsync(17, 41, new RenameCategoryCommand("Food")));
    }

    private sealed class FakeCategoryStore : ICategoryStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowNameConflict { get; init; }

        public bool ThrowConcurrency { get; init; }

        public bool WasRenameCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastCategoryId { get; private set; }

        public string? LastName { get; private set; }

        public Task<IReadOnlyList<CategoryDto>> ListAsync(
            long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CategoryDto>>([]);

        public Task<CategoryDto> CreateAsync(
            long userId, string name, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CategoryDto(1, name, 0));

        public Task RenameAsync(
            long userId, long categoryId, string name, CancellationToken cancellationToken = default)
        {
            WasRenameCalled = true;
            LastUserId = userId;
            LastCategoryId = categoryId;
            LastName = name;

            if (ThrowNotFound)
            {
                throw new CategoryNotFoundException();
            }

            if (ThrowNameConflict)
            {
                throw new CategoryNameConflictException();
            }

            if (ThrowConcurrency)
            {
                throw new CategoryConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
        }

        public Task DeleteAsync(long userId, long categoryId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}

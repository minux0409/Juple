using Juple.Application.Categories;
using Juple.Application.Categories.CreateCategory;

namespace Juple.UnitTests.Categories;

public sealed class CreateCategoryServiceTests
{
    [Fact]
    public async Task CreateAsync_TrimsNameOuterWhitespace()
    {
        var store = new FakeCategoryStore();
        var service = new CreateCategoryService(store);

        await service.CreateAsync(17, new CreateCategoryCommand("  Groceries  "));

        Assert.Equal("Groceries", store.LastCreatedName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateAsync_WhenNameIsMissingOrWhitespaceOnly_ThrowsInvalidCategory(string? name)
    {
        var store = new FakeCategoryStore();
        var service = new CreateCategoryService(store);

        var exception = await Assert.ThrowsAsync<InvalidCategoryException>(
            () => service.CreateAsync(17, new CreateCategoryCommand(name)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenNameExceeds100Characters_ThrowsInvalidCategory()
    {
        var store = new FakeCategoryStore();
        var service = new CreateCategoryService(store);
        var tooLongName = new string('a', 101);

        var exception = await Assert.ThrowsAsync<InvalidCategoryException>(
            () => service.CreateAsync(17, new CreateCategoryCommand(tooLongName)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenNameIsExactly100Characters_Succeeds()
    {
        var store = new FakeCategoryStore();
        var service = new CreateCategoryService(store);
        var maxLengthName = new string('a', 100);

        await service.CreateAsync(17, new CreateCategoryCommand(maxLengthName));

        Assert.Equal(maxLengthName, store.LastCreatedName);
    }

    [Fact]
    public async Task CreateAsync_CallsStoreWithCurrentUser()
    {
        var store = new FakeCategoryStore();
        var service = new CreateCategoryService(store);

        await service.CreateAsync(17, new CreateCategoryCommand("Groceries"));

        Assert.Equal(17, store.LastUserId);
    }

    [Fact]
    public async Task CreateAsync_WhenNameConflicts_PropagatesCategoryNameConflictException()
    {
        var store = new FakeCategoryStore { ThrowNameConflict = true };
        var service = new CreateCategoryService(store);

        await Assert.ThrowsAsync<CategoryNameConflictException>(
            () => service.CreateAsync(17, new CreateCategoryCommand("Groceries")));
    }

    private sealed class FakeCategoryStore : ICategoryStore
    {
        public bool ThrowNameConflict { get; init; }

        public bool WasCreateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public string? LastCreatedName { get; private set; }

        public Task<IReadOnlyList<CategoryDto>> ListAsync(
            long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CategoryDto>>([]);

        public Task<CategoryDto> CreateAsync(
            long userId, string name, CancellationToken cancellationToken = default)
        {
            WasCreateCalled = true;
            LastUserId = userId;
            LastCreatedName = name;

            if (ThrowNameConflict)
            {
                throw new CategoryNameConflictException();
            }

            return Task.FromResult(new CategoryDto(1, name, 0));
        }

        public Task RenameAsync(
            long userId, long categoryId, string name, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(long userId, long categoryId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}

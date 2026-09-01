using Juple.Application.Categories;
using Juple.Application.Categories.DeleteCategory;

namespace Juple.UnitTests.Categories;

public sealed class DeleteCategoryServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserAndCategoryId()
    {
        var store = new FakeCategoryStore();
        var service = new DeleteCategoryService(store);

        await service.DeleteAsync(17, 41);

        Assert.Equal((17L, 41L), store.LastDeleteCall);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var store = new FakeCategoryStore();
        var service = new DeleteCategoryService(store);

        await service.DeleteAsync(17, 41);
        await service.DeleteAsync(17, 41);

        Assert.Equal(2, store.DeleteCallCount);
    }

    private sealed class FakeCategoryStore : ICategoryStore
    {
        public int DeleteCallCount { get; private set; }

        public (long UserId, long CategoryId)? LastDeleteCall { get; private set; }

        public Task<IReadOnlyList<CategoryDto>> ListAsync(
            long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CategoryDto>>([]);

        public Task<CategoryDto> CreateAsync(
            long userId, string name, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CategoryDto(1, name, 0));

        public Task RenameAsync(
            long userId, long categoryId, string name, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(long userId, long categoryId, CancellationToken cancellationToken = default)
        {
            DeleteCallCount++;
            LastDeleteCall = (userId, categoryId);
            return Task.CompletedTask;
        }
    }
}

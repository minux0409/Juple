using Juple.Application.Categories;
using Juple.Application.Items;
using Juple.Application.Items.AssignItemCategory;

namespace Juple.UnitTests.Items;

public sealed class AssignItemCategoryServiceTests
{
    [Fact]
    public async Task AssignAsync_CallsStoreWithCurrentUserItemAndCategory()
    {
        var store = new FakeItemCategoryStore();
        var service = new AssignItemCategoryService(store);

        await service.AssignAsync(17, 41, 9);

        Assert.Equal((17L, 41L, (long?)9), store.LastCall);
    }

    [Fact]
    public async Task AssignAsync_WithNullCategoryId_ClearsCategory()
    {
        var store = new FakeItemCategoryStore();
        var service = new AssignItemCategoryService(store);

        await service.AssignAsync(17, 41, null);

        Assert.Equal((17L, 41L, (long?)null), store.LastCall);
    }

    [Fact]
    public async Task AssignAsync_WhenItemNotFound_PropagatesItemNotFoundException()
    {
        var store = new FakeItemCategoryStore { ThrowItemNotFound = true };
        var service = new AssignItemCategoryService(store);

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.AssignAsync(17, 41, 9));
    }

    [Fact]
    public async Task AssignAsync_WhenCategoryNotOwnedByUser_PropagatesCategoryNotFoundException()
    {
        var store = new FakeItemCategoryStore { ThrowCategoryNotFound = true };
        var service = new AssignItemCategoryService(store);

        await Assert.ThrowsAsync<CategoryNotFoundException>(() => service.AssignAsync(17, 41, 9));
    }

    [Fact]
    public async Task AssignAsync_WhenConcurrentWriteConflicts_PropagatesItemConcurrencyException()
    {
        var store = new FakeItemCategoryStore { ThrowConcurrency = true };
        var service = new AssignItemCategoryService(store);

        await Assert.ThrowsAsync<ItemConcurrencyException>(() => service.AssignAsync(17, 41, 9));
    }

    private sealed class FakeItemCategoryStore : IItemCategoryStore
    {
        public bool ThrowItemNotFound { get; init; }

        public bool ThrowCategoryNotFound { get; init; }

        public bool ThrowConcurrency { get; init; }

        public (long UserId, long ItemId, long? CategoryId)? LastCall { get; private set; }

        public Task AssignCategoryAsync(
            long userId,
            long itemId,
            long? categoryId,
            CancellationToken cancellationToken = default)
        {
            LastCall = (userId, itemId, categoryId);

            if (ThrowItemNotFound)
            {
                throw new ItemNotFoundException();
            }

            if (ThrowCategoryNotFound)
            {
                throw new CategoryNotFoundException();
            }

            if (ThrowConcurrency)
            {
                throw new ItemConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
        }
    }
}

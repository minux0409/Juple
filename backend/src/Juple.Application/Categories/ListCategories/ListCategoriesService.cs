namespace Juple.Application.Categories.ListCategories;

public sealed class ListCategoriesService(ICategoryStore categoryStore) : IListCategoriesService
{
    public Task<IReadOnlyList<CategoryDto>> ListAsync(long userId, CancellationToken cancellationToken = default) =>
        categoryStore.ListAsync(userId, cancellationToken);
}

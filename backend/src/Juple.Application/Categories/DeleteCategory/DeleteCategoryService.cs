namespace Juple.Application.Categories.DeleteCategory;

public sealed class DeleteCategoryService(ICategoryStore categoryStore) : IDeleteCategoryService
{
    public Task DeleteAsync(long userId, long categoryId, CancellationToken cancellationToken = default) =>
        categoryStore.DeleteAsync(userId, categoryId, cancellationToken);
}

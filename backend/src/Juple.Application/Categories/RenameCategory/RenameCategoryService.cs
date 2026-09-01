namespace Juple.Application.Categories.RenameCategory;

public sealed class RenameCategoryService(ICategoryStore categoryStore) : IRenameCategoryService
{
    public Task RenameAsync(
        long userId,
        long categoryId,
        RenameCategoryCommand command,
        CancellationToken cancellationToken = default)
    {
        var name = CategoryNameNormalizer.Normalize(command.Name);
        return categoryStore.RenameAsync(userId, categoryId, name, cancellationToken);
    }
}

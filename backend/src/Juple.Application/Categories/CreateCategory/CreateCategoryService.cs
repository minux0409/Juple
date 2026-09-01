namespace Juple.Application.Categories.CreateCategory;

public sealed class CreateCategoryService(ICategoryStore categoryStore) : ICreateCategoryService
{
    public Task<CategoryDto> CreateAsync(
        long userId,
        CreateCategoryCommand command,
        CancellationToken cancellationToken = default)
    {
        var name = CategoryNameNormalizer.Normalize(command.Name);
        return categoryStore.CreateAsync(userId, name, cancellationToken);
    }
}

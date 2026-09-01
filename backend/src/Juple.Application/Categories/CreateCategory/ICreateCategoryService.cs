namespace Juple.Application.Categories.CreateCategory;

public interface ICreateCategoryService
{
    Task<CategoryDto> CreateAsync(
        long userId,
        CreateCategoryCommand command,
        CancellationToken cancellationToken = default);
}

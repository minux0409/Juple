namespace Juple.Application.Categories.ListCategories;

public interface IListCategoriesService
{
    Task<IReadOnlyList<CategoryDto>> ListAsync(long userId, CancellationToken cancellationToken = default);
}

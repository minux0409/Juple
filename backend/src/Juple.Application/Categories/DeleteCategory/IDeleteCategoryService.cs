namespace Juple.Application.Categories.DeleteCategory;

public interface IDeleteCategoryService
{
    Task DeleteAsync(long userId, long categoryId, CancellationToken cancellationToken = default);
}

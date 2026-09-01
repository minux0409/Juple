namespace Juple.Application.Items.AssignItemCategory;

public interface IAssignItemCategoryService
{
    Task AssignAsync(
        long userId,
        long itemId,
        long? categoryId,
        CancellationToken cancellationToken = default);
}

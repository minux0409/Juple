namespace Juple.Application.Items.AssignItemCategory;

public sealed class AssignItemCategoryService(IItemCategoryStore itemCategoryStore) : IAssignItemCategoryService
{
    public Task AssignAsync(
        long userId,
        long itemId,
        long? categoryId,
        CancellationToken cancellationToken = default) =>
        itemCategoryStore.AssignCategoryAsync(userId, itemId, categoryId, cancellationToken);
}

namespace Juple.Application.Items;

public interface IItemCategoryStore
{
    /// <summary>
    /// Assigns (or, when categoryId is null, clears) the caller's Item's Category. When categoryId
    /// is non-null, the Category must also be owned by this userId.
    /// </summary>
    Task AssignCategoryAsync(
        long userId,
        long itemId,
        long? categoryId,
        CancellationToken cancellationToken = default);
}

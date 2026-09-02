namespace Juple.Application.Purchases;

public interface IPurchaseStore
{
    /// <summary>
    /// When itemId is not null, restricts the page to that Item's Purchases and throws
    /// Juple.Application.Items.ItemNotFoundException unless the Item is owned by userId - mirrors
    /// CreateAsync/UpdateAsync's identical ItemId ownership check.
    /// </summary>
    Task<PurchasePage> ListAsync(
        long userId,
        PurchasePageCursor? cursor,
        int limit,
        long? itemId = null,
        CancellationToken cancellationToken = default);

    /// <summary>Returns null when no Purchase with this Id is owned by this UserId.</summary>
    Task<PurchaseDto?> GetAsync(long userId, long purchaseId, CancellationToken cancellationToken = default);

    /// <summary>
    /// When fields.ItemId is not null, throws Juple.Application.Items.ItemNotFoundException unless
    /// that Item is owned by userId - mirrors IItemCategoryStore.AssignCategoryAsync's identical
    /// cross-module ownership check for Category.
    /// </summary>
    Task<PurchaseDto> CreateAsync(
        long userId,
        PurchaseFields fields,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Full replacement update. Throws PurchaseNotFoundException for a missing/other-user Purchase,
    /// or Juple.Application.Items.ItemNotFoundException per the same ItemId ownership rule as
    /// CreateAsync.
    /// </summary>
    Task UpdateAsync(
        long userId,
        long purchaseId,
        PurchaseFields fields,
        CancellationToken cancellationToken = default);

    /// <summary>A missing or other-user's Purchase is treated as already deleted and completes without error.</summary>
    Task DeleteAsync(long userId, long purchaseId, CancellationToken cancellationToken = default);
}

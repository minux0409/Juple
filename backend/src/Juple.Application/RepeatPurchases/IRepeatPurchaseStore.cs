namespace Juple.Application.RepeatPurchases;

public interface IRepeatPurchaseStore
{
    /// <summary>
    /// When itemId is not null, restricts the page to that Item's RepeatPurchases and throws
    /// Juple.Application.Items.ItemNotFoundException unless the Item is owned by userId - mirrors
    /// IPurchaseStore.ListAsync's identical itemId ownership check. includeDisabled=false (the
    /// default) restricts the page to IsEnabled RepeatPurchases only.
    /// </summary>
    Task<RepeatPurchasePage> ListAsync(
        long userId,
        RepeatPurchasePageCursor? cursor,
        int limit,
        long? itemId,
        bool includeDisabled,
        CancellationToken cancellationToken = default);

    /// <summary>Returns null when no RepeatPurchase with this Id is owned by this UserId.</summary>
    Task<RepeatPurchaseDto?> GetAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default);

    /// <summary>
    /// When fields.ItemId is not null, throws Juple.Application.Items.ItemNotFoundException unless
    /// that Item is owned by userId - mirrors IPurchaseStore.CreateAsync's identical cross-module
    /// ownership check. Always creates with IsEnabled=true.
    /// </summary>
    Task<RepeatPurchaseDto> CreateAsync(
        long userId,
        RepeatPurchaseFields fields,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Full replacement update (IsEnabled excluded - see RepeatPurchase.Update). expectedVersion
    /// must be the RowVersion the client last read; a mismatch against the row's current RowVersion
    /// throws RepeatPurchaseConcurrencyException instead of silently overwriting a change the client
    /// never saw. Throws RepeatPurchaseNotFoundException for a missing/other-user RepeatPurchase, or
    /// Juple.Application.Items.ItemNotFoundException per the same ItemId ownership rule as
    /// CreateAsync. Returns the updated row (with its new RowVersion) so the caller never has to
    /// issue a follow-up GET just to learn the new version.
    /// </summary>
    Task<RepeatPurchaseDto> UpdateAsync(
        long userId,
        long repeatPurchaseId,
        RepeatPurchaseFields fields,
        byte[] expectedVersion,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent - already-enabled succeeds too (a no-op that leaves RowVersion unchanged; see
    /// RepeatPurchase.Enable). Throws RepeatPurchaseNotFoundException for a missing/other-user row.
    /// Returns the post-transition row so the caller is never left holding a version that went
    /// stale the instant its own call committed.
    /// </summary>
    Task<RepeatPurchaseDto> EnableAsync(
        long userId, long repeatPurchaseId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default);

    /// <summary>Idempotent counterpart to EnableAsync - see its remarks.</summary>
    Task<RepeatPurchaseDto> DisableAsync(
        long userId, long repeatPurchaseId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default);

    /// <summary>A missing or other-user's RepeatPurchase is treated as already deleted and completes without error.</summary>
    Task DeleteAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default);
}

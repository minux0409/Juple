namespace Juple.Application.Collections;

/// <summary>
/// Keyset pagination position for a Collection's Item list, ordered by AddedAtUtc DESC, ItemId
/// DESC (the order the Item was added to this Collection - never SavedAtUtc/StateChangedAtUtc).
/// Carries no authorization information - callers still filter by the owning Collection/UserId
/// independently.
/// </summary>
public sealed record CollectionItemPageCursor(DateTimeOffset AddedAtUtc, long ItemId);

namespace Juple.Application.Collections;

/// <summary>
/// Keyset pagination position for a Collection's Item list, ordered by SortOrder ASC, ItemId ASC -
/// the owner's manual display order (see CollectionItem.SortOrder), not insertion time. Carries no
/// authorization information - callers still filter by the owning Collection/UserId independently.
/// </summary>
public sealed record CollectionItemPageCursor(int SortOrder, long ItemId);

namespace Juple.Application.Items;

/// <summary>
/// Keyset pagination position for the "최근 본 링크" list, ordered by LastOpenedAtUtc DESC, ItemId
/// DESC. Re-opening an Item already on a loaded page changes its LastOpenedAtUtc and moves it to
/// the top - see GetRecentlyOpenedLinksScreen (Mobile), which resets to the first page after an
/// open rather than trying to reconcile a row's position mid-list. Carries no authorization
/// information - callers still filter by UserId independently.
/// </summary>
public sealed record RecentlyOpenedItemPageCursor(DateTimeOffset LastOpenedAtUtc, long ItemId);

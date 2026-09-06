namespace Juple.Application.Items;

/// <summary>
/// One "최근 본 링크" (Recently opened links) row - the current Title/Url of the Item the user
/// opened, plus when they last opened it. Deliberately minimal: no Memo/Category/Purchase/
/// RepeatPurchase - this list is a quick "open it again" shortcut, not another Item detail view.
/// </summary>
public sealed record RecentlyOpenedItemEntryDto(long ItemId, string Url, string? Title, DateTimeOffset LastOpenedAtUtc);

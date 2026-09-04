namespace Juple.Application.Items;

/// <summary>
/// One page of a single local calendar date's History (see GetItemHistoryByDate) - Items the user
/// saved (SavedAtUtc) that local date, regardless of current Inbox/Wishlist/Archived state. Used
/// by Home ("오늘 저장한 링크") so its Item set is always identical to History's own "오늘" section
/// for the same date - both are ultimately the same query/cursor semantics (SavedAtUtc DESC, Id
/// DESC), just windowed differently (a single date range here vs an open-ended cursor in History).
/// Cursor-paginated like History - a day's worth of Items is unbounded, so this is never returned
/// as a single all-of-day response.
/// </summary>
public sealed record ItemHistoryByDateResult(
    DateOnly Date,
    IReadOnlyList<ItemHistoryEntryDto> Items,
    ItemHistoryPageCursor? NextCursor);

namespace Juple.Application.Items;

public sealed record RecentlyOpenedItemPage(
    IReadOnlyList<RecentlyOpenedItemEntryDto> Items,
    RecentlyOpenedItemPageCursor? NextCursor);

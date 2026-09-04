namespace Juple.Application.Items;

public sealed record ItemHistoryPage(IReadOnlyList<ItemHistoryEntryDto> Items, ItemHistoryPageCursor? NextCursor);

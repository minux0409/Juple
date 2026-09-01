namespace Juple.Application.Items;

public sealed record ItemPage(IReadOnlyList<ItemListEntryDto> Items, ItemPageCursor? NextCursor);

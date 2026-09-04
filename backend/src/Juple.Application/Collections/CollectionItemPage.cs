namespace Juple.Application.Collections;

public sealed record CollectionItemPage(
    IReadOnlyList<CollectionItemEntryDto> Items,
    CollectionItemPageCursor? NextCursor);

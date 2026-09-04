namespace Juple.Application.Collections;

public sealed record CollectionPage(IReadOnlyList<CollectionDto> Items, CollectionPageCursor? NextCursor);

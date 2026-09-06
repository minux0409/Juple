using Juple.Application.Collections;

namespace Juple.Application.Collections.Public;

public sealed record PublicCollectionItemPage(
    IReadOnlyList<PublicCollectionItemDto> Items,
    CollectionItemPageCursor? NextCursor);

namespace Juple.Application.Collections;

/// <summary>
/// Keyset pagination position for the Collection list, ordered by CreatedAtUtc DESC, Id DESC. Kept
/// as its own type - never reused as/for CollectionItemPageCursor - since the two are independent
/// pagination contracts (Collection.CreatedAtUtc/Id vs CollectionItem.AddedAtUtc/ItemId) that must
/// never be interchangeable, even though they happen to share the same on-wire shape today. Carries
/// no authorization information - callers still filter by UserId independently.
/// </summary>
public sealed record CollectionPageCursor(DateTimeOffset CreatedAtUtc, long Id);

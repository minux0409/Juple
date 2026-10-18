namespace Juple.Application.Collections.ListCollections;

/// <summary>
/// The quick suggestions under the Collections search box: a few Collections (the very Collection cards the list shows) and a few links,
/// never the whole result - the list behind it (GET /collections?q=) stays the complete answer.
/// </summary>
public sealed record CollectionSearchSuggestions(
    IReadOnlyList<CollectionDto> Collections,
    IReadOnlyList<CollectionLinkSuggestionDto> Links);

/// <summary>
/// One saved link that matches, with the Collection it was found in. Nothing else is carried: no memo, no adder, no preview image; the host
/// recognises the link and the saved URL is only for the "open original" button. <see cref="IsMine"/> is whether the link is the caller's own Item - the clients open an own
/// link and another member's link through different screens.
/// </summary>
public sealed record CollectionLinkSuggestionDto(
    long ItemId,
    long CollectionId,
    string CollectionName,
    string Title,
    string? Hostname,
    bool IsMine,
    // The saved URL exactly as the link has it, for the "open original" button. Only ever on a link that passed the same access / lock /
    // trash rules as the suggestion itself, so it reveals nothing the person could not already open.
    string Url);

public interface ICollectionSearchSuggestionStore
{
    Task<CollectionSearchSuggestions> SuggestAsync(
        long userId,
        CollectionListScope scope,
        CollectionListSearch search,
        CancellationToken cancellationToken = default);
}

public sealed class CollectionSearchSuggestionsService(ICollectionSearchSuggestionStore store)
{
    public Task<CollectionSearchSuggestions> SuggestAsync(
        long userId,
        CollectionListScope scope,
        CollectionListSearch search,
        CancellationToken cancellationToken = default) =>
        store.SuggestAsync(userId, scope, search, cancellationToken);
}

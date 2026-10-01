using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.Reactions;

/// <summary>
/// The reactions a link can get: stable keys (the app maps each to its emoji). The server accepts
/// only these - never arbitrary Unicode - so the stored value does not depend on any platform's
/// emoji sequences, and the catalog can grow by adding keys. Order is the catalog order (the app
/// shows it, and breaks ties between equally used reactions by it).
/// </summary>
public static class CollectionReactionCatalog
{
    public const int MaxKeyLength = 32;

    public static readonly IReadOnlyList<string> Keys =
    [
        "heart", "thumbsUp", "check", "laugh", "wow", "sad",
        "heartEyes", "lovingFace", "smile", "kiss", "fire", "eyes",
        "pray", "party", "cool", "thinking", "cry", "angry",
        "thumbsDown", "clap", "ok", "muscle", "hundred", "handshake",
        "rofl", "salute", "blueHeart", "purpleHeart", "greenHeart", "yellowHeart",
        "brokenHeart", "star", "sparkles", "rocket", "bulb", "pin",
    ];

    private static readonly HashSet<string> KeySet = new(Keys, StringComparer.Ordinal);

    public static bool IsKnown(string? key) => key is not null && KeySet.Contains(key);

    /// <summary>The position in the catalog (unknown keys last) - the tie-break between equally used reactions.</summary>
    public static int OrderOf(string key)
    {
        for (var index = 0; index < Keys.Count; index++)
        {
            if (Keys[index] == key)
            {
                return index;
            }
        }

        return int.MaxValue;
    }
}

/// <summary>How many people reacted with this key.</summary>
public sealed record ReactionCountDto(string Key, int Count);

/// <summary>
/// What a link's reactions look like to the caller: the counts per reaction (most used first, ties
/// in catalog order) and the caller's own reaction. Never who reacted.
/// </summary>
public sealed record CollectionItemReactionsDto(IReadOnlyList<ReactionCountDto> Reactions, string? MyReaction);

public interface ICollectionItemReactionStore
{
    /// <summary>
    /// Makes key the caller's one reaction to this link: none yet - it is added; another - the same
    /// row is rewritten; the same - nothing changes. One atomic write either way (a concurrent change
    /// by the same person ends with exactly one row). False when the Item is not a link of the
    /// Collection (or is in the trash).
    /// </summary>
    Task<bool> SetAsync(long userId, long collectionId, long itemId, string key, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Removes the caller's reaction to this link; nothing to remove is a success.</summary>
    Task DeleteAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Counts and the caller's own reaction for these links of one Collection - two statements for
    /// the whole page, never one per link. Links nobody reacted to are absent.
    /// </summary>
    Task<IReadOnlyDictionary<long, CollectionItemReactionsDto>> GetSummariesAsync(
        long userId, long collectionId, IReadOnlyCollection<long> itemIds, CancellationToken cancellationToken = default);
}

public interface ICollectionItemReactionService
{
    Task<CollectionItemReactionsDto> SetAsync(long userId, long collectionId, long itemId, string? reactionKey, string? unlockToken, CancellationToken cancellationToken = default);

    Task<CollectionItemReactionsDto> DeleteAsync(long userId, long collectionId, long itemId, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// Reacting is for the Collection's people only: the Owner and accepted members, whatever their role
/// (Viewer, Submitter, Contributor) - a light way to answer a link, not a way to change the
/// Collection. Anyone else (a pending invitee, a non-member, a holder of the public link) is told the
/// Collection does not exist. The same content gate as reading the links applies: a locked or
/// share-password-protected Collection needs its grant first, the Owner included.
/// </summary>
public sealed class CollectionItemReactionService(
    ICollectionAccessService accessService,
    ICollectionItemReactionStore store,
    TimeProvider timeProvider) : ICollectionItemReactionService
{
    public async Task<CollectionItemReactionsDto> SetAsync(
        long userId, long collectionId, long itemId, string? reactionKey, string? unlockToken, CancellationToken cancellationToken = default)
    {
        if (!CollectionReactionCatalog.IsKnown(reactionKey))
        {
            throw new InvalidCollectionException("reactionKey", "Unknown reaction.");
        }

        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        if (!await store.SetAsync(userId, collectionId, itemId, reactionKey!, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new CollectionNotFoundException();
        }

        return await SummaryOfAsync(userId, collectionId, itemId, cancellationToken);
    }

    public async Task<CollectionItemReactionsDto> DeleteAsync(
        long userId, long collectionId, long itemId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        await store.DeleteAsync(userId, collectionId, itemId, cancellationToken);
        return await SummaryOfAsync(userId, collectionId, itemId, cancellationToken);
    }

    private async Task<CollectionItemReactionsDto> SummaryOfAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken)
    {
        var summaries = await store.GetSummariesAsync(userId, collectionId, [itemId], cancellationToken);
        return summaries.TryGetValue(itemId, out var summary) ? summary : new CollectionItemReactionsDto([], null);
    }
}

using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

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

/// <summary>What setting a reaction did to the caller's one row on the link.</summary>
public enum CollectionReactionWrite
{
    /// <summary>The Item is not a link of the Collection (or is in the trash) - nothing written.</summary>
    NotALink,

    /// <summary>The caller had no reaction on the link before.</summary>
    Added,

    /// <summary>The caller's reaction was another one before.</summary>
    Changed,

    /// <summary>The caller already had exactly this reaction - nothing changed.</summary>
    Unchanged,
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
    /// by the same person ends with exactly one row). Says which of these happened (NotALink when the
    /// Item is not a link of the Collection, or is in the trash).
    /// </summary>
    Task<CollectionReactionWrite> SetAsync(long userId, long collectionId, long itemId, string key, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

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
/// share-password-protected Collection needs its grant first, the Owner included. A new or changed
/// reaction on someone else's link tells that link's owner (best-effort, after the write); removing a
/// reaction, or setting the one already there, tells nobody.
/// </summary>
public sealed class CollectionItemReactionService(
    ICollectionAccessService accessService,
    ICollectionItemReactionStore store,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : ICollectionItemReactionService
{
    public async Task<CollectionItemReactionsDto> SetAsync(
        long userId, long collectionId, long itemId, string? reactionKey, string? unlockToken, CancellationToken cancellationToken = default)
    {
        if (!CollectionReactionCatalog.IsKnown(reactionKey))
        {
            throw new InvalidCollectionException("reactionKey", "Unknown reaction.");
        }

        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        var write = await store.SetAsync(userId, collectionId, itemId, reactionKey!, timeProvider.GetUtcNow(), cancellationToken);
        if (write == CollectionReactionWrite.NotALink)
        {
            throw new CollectionNotFoundException();
        }

        if (write is CollectionReactionWrite.Added or CollectionReactionWrite.Changed && notifications is not null)
        {
            // The publisher decides who the link's owner is and skips the reactor's own link.
            await notifications.CollectionItemReactionReceivedAsync(userId, collectionId, itemId, cancellationToken);
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

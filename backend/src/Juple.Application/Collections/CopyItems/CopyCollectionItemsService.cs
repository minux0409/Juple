using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.CopyItems;

/// <param name="Copied">Links now in the destination because of this call.</param>
/// <param name="AlreadyInDestination">Skipped: the destination already had a link with the same URL (or it was selected twice).</param>
/// <param name="Unavailable">Skipped: no longer in the source Collection (removed or deleted since the list was loaded).</param>
public sealed record CopyCollectionItemsResult(int Copied, int AlreadyInDestination, int Unavailable);

public interface ICollectionItemCopyStore
{
    /// <summary>
    /// Copies the given links of sourceCollectionId into destinationCollectionId (which the caller
    /// owns), as the caller's own new, independent Items with only the fields every participant
    /// already sees (URL, title, automatic preview image) - never the memo, uploaded images, the
    /// adder or any id. A link the caller already owns is added as itself instead of duplicated.
    /// One transaction under the destination row lock. CollectionNotFoundException when the
    /// destination is gone.
    /// </summary>
    Task<CopyCollectionItemsResult> CopyAsync(
        long userId,
        long sourceCollectionId,
        IReadOnlyList<long> itemIds,
        long destinationCollectionId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);
}

public interface ICopyCollectionItemsService
{
    Task<CopyCollectionItemsResult> CopyAsync(
        long userId,
        long sourceCollectionId,
        IReadOnlyCollection<long>? itemIds,
        long destinationCollectionId,
        string? unlockToken,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// 내 컬렉션으로 복사: a participant of a Collection shared WITH them (Contributor or Viewer - reading is
/// enough, since the copy only holds what they can already see) copies selected links into a
/// Collection of their OWN. Both sides pass the same content gates as reading/adding: the source's
/// share password (or legacy lock) grant, the destination's own lock grant. The source is never
/// changed and its people are never told; the destination's other members get one grouped
/// new-link notification. At most MaxItemsPerCopy links per call - one bounded transaction.
/// </summary>
public sealed class CopyCollectionItemsService(
    ICollectionAccessService accessService,
    ICollectionItemCopyStore copyStore,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : ICopyCollectionItemsService
{
    public const int MaxItemsPerCopy = 200;

    public async Task<CopyCollectionItemsResult> CopyAsync(
        long userId,
        long sourceCollectionId,
        IReadOnlyCollection<long>? itemIds,
        long destinationCollectionId,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        var ids = itemIds?.Distinct().ToList() ?? [];
        if (ids.Count == 0)
        {
            throw new InvalidCollectionException("itemIds", "Select at least one link.");
        }

        if (ids.Count > MaxItemsPerCopy)
        {
            throw new InvalidCollectionException("itemIds", $"At most {MaxItemsPerCopy} links can be copied at once.");
        }

        if (sourceCollectionId == destinationCollectionId)
        {
            throw new InvalidCollectionException("destinationCollectionId", "Choose a different Collection.");
        }

        var source = await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.View, unlockToken, cancellationToken);
        if (source.IsOwner)
        {
            // Only for Collections shared with the caller - their own links move with transfer/merge.
            throw new CollectionForbiddenException();
        }

        var destination = await accessService.RequireUnlockedAsync(userId, destinationCollectionId, CollectionPermission.AddItem, unlockToken, cancellationToken);
        if (!destination.IsOwner)
        {
            throw new CollectionForbiddenException();
        }

        var result = await copyStore.CopyAsync(userId, sourceCollectionId, ids, destinationCollectionId, timeProvider.GetUtcNow(), cancellationToken);
        if (result.Copied > 0 && notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [destinationCollectionId], cancellationToken);
            await notifications.CollectionItemsAddedAsync(userId, destinationCollectionId, result.Copied, hideActor: false, cancellationToken);
        }

        return result;
    }
}

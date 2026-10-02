using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.AddItemToCollections;

/// <param name="Added">Collections the Item is in now because of this call.</param>
/// <param name="Skipped">Collections it was already in (a no-op, as with the single add).</param>
public sealed record AddItemToCollectionsResult(int Added, int Skipped);

public interface IAddItemToCollectionsService
{
    Task<AddItemToCollectionsResult> AddAsync(
        long userId,
        long itemId,
        IReadOnlyCollection<long>? collectionIds,
        IReadOnlyDictionary<long, string>? unlockTokens,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// 다른 컬렉션에 복제: puts one of the caller's own Items into several of the caller's OWN Collections
/// at once - the same membership write as the single add (AddItemToCollectionService), never a copy
/// of the Item. Only the caller's own Collections (a Collection shared with them is not a
/// destination here). Every destination passes the same gate as the single add - AddItem, and for a
/// locked one a valid unlock grant for THAT Collection (grants are per Collection, sent per
/// destination) - and all of them are checked before anything is written. The writes then happen in
/// ONE database transaction together with the notification rows they cause: all of them are kept, or
/// - on any failure before the commit - none (no half-done batch, no notification about a link that
/// is not there). A Collection already holding the Item is skipped (so a retry is safe); each
/// Collection that actually gained the Item gets its own new-link notification (other members only).
/// </summary>
public sealed class AddItemToCollectionsService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    ICollectionWriteTransactions transactions,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : IAddItemToCollectionsService
{
    public const int MaxCollectionsPerRequest = 200;

    public async Task<AddItemToCollectionsResult> AddAsync(
        long userId,
        long itemId,
        IReadOnlyCollection<long>? collectionIds,
        IReadOnlyDictionary<long, string>? unlockTokens,
        CancellationToken cancellationToken = default)
    {
        var ids = collectionIds?.Distinct().ToList() ?? [];
        if (ids.Count == 0)
        {
            throw new InvalidCollectionException("collectionIds", "Select at least one Collection.");
        }

        if (ids.Count > MaxCollectionsPerRequest)
        {
            throw new InvalidCollectionException("collectionIds", $"At most {MaxCollectionsPerRequest} Collections can be chosen at once.");
        }

        foreach (var collectionId in ids)
        {
            var access = await accessService.RequireUnlockedAsync(
                userId, collectionId, CollectionPermission.AddItem, unlockTokens?.GetValueOrDefault(collectionId), cancellationToken);
            if (!access.IsOwner)
            {
                throw new CollectionForbiddenException();
            }
        }

        var nowUtc = timeProvider.GetUtcNow();
        var added = new List<long>();
        await using (var transaction = await transactions.BeginAsync(cancellationToken))
        {
            foreach (var collectionId in ids)
            {
                if (await collectionItemStore.AddAsync(userId, collectionId, itemId, nowUtc, cancellationToken))
                {
                    added.Add(collectionId);
                }
            }

            // Outbox events only (Push is sent later, asynchronously) - inside the transaction, so
            // they exist exactly when the links they announce do.
            if (notifications is not null && added.Count > 0)
            {
                await notifications.CollectionsChangedAsync(userId, added, cancellationToken);
                foreach (var collectionId in added)
                {
                    await notifications.CollectionItemsAddedAsync(userId, collectionId, 1, hideActor: false, cancellationToken);
                }
            }

            await transaction.CommitAsync(cancellationToken);
        }

        if (notifications is not null)
        {
            // Committed: wake the notification worker (best-effort; the recovery Job covers a lost signal).
            await notifications.FlushSignalsAsync(cancellationToken);
        }

        return new AddItemToCollectionsResult(added.Count, ids.Count - added.Count);
    }
}

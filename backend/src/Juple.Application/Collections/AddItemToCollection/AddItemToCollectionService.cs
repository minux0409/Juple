using Juple.Application.Collections.Access;
using Juple.Application.Collections.Submissions;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.AddItemToCollection;

public sealed class AddItemToCollectionService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null,
    ICollectionLinkSubmissionStore? submissions = null) : IAddItemToCollectionService
{
    /// <summary>
    /// Owner or Contributor (AddItem) adds directly; a Submitter (승인 후 추가) proposes it instead - it
    /// waits for the Owner and is not part of the Collection (nobody is notified) until approved; a
    /// Viewer may do neither. The role is the server's, never the app's. For a locked Collection a
    /// valid unlock grant first - adding changes the content, which the lock protects. The Item must
    /// be the caller's own (enforced by the stores).
    /// </summary>
    public async Task<CollectionLinkAddOutcome> AddAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        var access = await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.View, unlockToken, cancellationToken);
        if (!access.Allows(CollectionPermission.AddItem))
        {
            if (!access.Allows(CollectionPermission.SubmitLink) || submissions is null)
            {
                throw new CollectionForbiddenException();
            }

            var outcome = await submissions.SubmitAsync(userId, collectionId, itemId, requiredPublicId: null, timeProvider.GetUtcNow(), cancellationToken)
                ?? throw new CollectionNotFoundException();
            if (outcome == CollectionLinkAddOutcome.Submitted && notifications is not null)
            {
                // A recorded proposal (a duplicate or a failure threw above): its Owner is told.
                await notifications.CollectionLinkSubmittedAsync(userId, collectionId, itemId, cancellationToken);
            }

            return outcome;
        }

        var added = await collectionItemStore.AddAsync(userId, collectionId, itemId, timeProvider.GetUtcNow(), cancellationToken);
        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
            if (added)
            {
                await notifications.CollectionItemsAddedAsync(userId, collectionId, 1, hideActor: false, cancellationToken);
            }
        }

        return CollectionLinkAddOutcome.Added;
    }
}

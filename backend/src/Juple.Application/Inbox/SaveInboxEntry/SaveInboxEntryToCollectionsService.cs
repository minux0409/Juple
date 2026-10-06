using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Submissions;
using Juple.Application.Notifications;

namespace Juple.Application.Inbox.SaveInboxEntry;

/// <summary>What happened in each chosen Collection when a link was saved into them (see ISaveInboxEntryToCollectionsService).</summary>
/// <param name="Added">Collections the new link is now in.</param>
/// <param name="Submitted">승인 후 추가 Collections it was proposed to - waiting for their Owner.</param>
/// <param name="AlreadyInCollection">Collections that already had this link (nothing written there).</param>
/// <param name="AlreadyPending">Collections where this link was already waiting for the Owner (nothing written there).</param>
public sealed record SaveInboxEntryCollectionsOutcome(int Added, int Submitted, int AlreadyInCollection, int AlreadyPending);

public sealed record SaveInboxEntryToCollectionsResult(InboxEntrySaveResult Save, SaveInboxEntryCollectionsOutcome Collections);

public interface ISaveInboxEntryToCollectionsService
{
    /// <summary>
    /// The 링크 저장 screen's one save: the link (as POST inbox - same URL rules, Collection-share-link guard and
    /// clientRequestId replay) and its chosen Collections together. An empty list is an explicit "no Collection".
    /// </summary>
    Task<SaveInboxEntryToCollectionsResult> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        IReadOnlyCollection<long> collectionIds,
        IReadOnlyDictionary<long, string>? unlockTokens,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Saves ONE Item and gives it a membership in every chosen Collection (Item ↔ CollectionItem is many-to-many - the
/// Item is never copied per Collection). Order of work, so the save is never a surprising partial set:
///  1. every destination is checked first, before anything is written: the caller must be able to add to it (Owner or
///     Contributor adds; a Submitter of a 승인 후 추가 Collection proposes) and, for a locked Collection, hold a valid grant
///     for THAT Collection - one failing destination fails the whole save with nothing written;
///  2. the Item is saved (idempotent by clientRequestId, exactly as POST inbox);
///  3. all memberships and proposals, with the notification events they cause, are written in ONE transaction - all of
///     them or none.
/// Between 2 and 3 a failure (e.g. a lost connection) leaves the saved link without its Collections; the client's retry
/// with the same clientRequestId replays the same Item and finishes the Collections (a Collection that already has it
/// counts as already there), so a retry converges instead of duplicating anything.
/// </summary>
public sealed class SaveInboxEntryToCollectionsService(
    IInboxEntrySaveService inboxEntrySaveService,
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    ICollectionWriteTransactions transactions,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null,
    ICollectionLinkSubmissionStore? submissions = null) : ISaveInboxEntryToCollectionsService
{
    public const int MaxCollectionsPerSave = 200;

    public async Task<SaveInboxEntryToCollectionsResult> SaveAsync(
        long userId,
        SaveInboxEntryCommand command,
        IReadOnlyCollection<long> collectionIds,
        IReadOnlyDictionary<long, string>? unlockTokens,
        CancellationToken cancellationToken = default)
    {
        var ids = collectionIds.Distinct().ToList();
        if (ids.Count > MaxCollectionsPerSave)
        {
            throw new InvalidInboxRequestException("collectionIds", $"At most {MaxCollectionsPerSave} Collections can be chosen at once.");
        }

        // 1. Every destination first - nothing is written unless all of them can take the link.
        var proposalOnly = new HashSet<long>();
        foreach (var collectionId in ids)
        {
            var access = await accessService.RequireUnlockedAsync(
                userId, collectionId, CollectionPermission.View, unlockTokens?.GetValueOrDefault(collectionId), cancellationToken);
            if (access.Allows(CollectionPermission.AddItem))
            {
                continue;
            }

            if (!access.Allows(CollectionPermission.SubmitLink) || submissions is null)
            {
                throw new CollectionForbiddenException();
            }

            proposalOnly.Add(collectionId);
        }

        // 2. The Item (a replay of the same clientRequestId returns the Item it already created).
        var save = await inboxEntrySaveService.SaveAsync(userId, command, cancellationToken);
        if (ids.Count == 0)
        {
            return new SaveInboxEntryToCollectionsResult(save, new SaveInboxEntryCollectionsOutcome(0, 0, 0, 0));
        }

        // 3. All Collections in one transaction, with the notification events they cause.
        var itemId = save.Entry.Id;
        var nowUtc = timeProvider.GetUtcNow();
        var added = new List<long>();
        var submitted = new List<long>();
        int alreadyIn = 0, alreadyPending = 0;
        await using (var transaction = await transactions.BeginAsync(cancellationToken))
        {
            foreach (var collectionId in ids)
            {
                if (!proposalOnly.Contains(collectionId))
                {
                    if (await collectionItemStore.AddAsync(userId, collectionId, itemId, nowUtc, cancellationToken))
                    {
                        added.Add(collectionId);
                    }
                    else
                    {
                        alreadyIn++;
                    }

                    continue;
                }

                try
                {
                    var outcome = await submissions!.SubmitAsync(userId, collectionId, itemId, requiredPublicId: null, nowUtc, cancellationToken)
                        ?? throw new CollectionNotFoundException();
                    if (outcome == CollectionLinkAddOutcome.Submitted)
                    {
                        submitted.Add(collectionId);
                    }
                    else
                    {
                        added.Add(collectionId);
                    }
                }
                // Both are decided before the proposal row is written, so nothing of this Collection is pending in the
                // transaction: the link simply is (or waits) there already.
                catch (CollectionCollaborationConflictException conflict) when (conflict.Code == CollectionCollaborationConflictException.LinkAlreadyInCollection)
                {
                    alreadyIn++;
                }
                catch (CollectionCollaborationConflictException conflict) when (conflict.Code == CollectionCollaborationConflictException.LinkAlreadyPending)
                {
                    alreadyPending++;
                }
            }

            if (notifications is not null)
            {
                if (added.Count > 0)
                {
                    await notifications.CollectionsChangedAsync(userId, added, cancellationToken);
                    foreach (var collectionId in added)
                    {
                        await notifications.CollectionItemsAddedAsync(userId, collectionId, 1, hideActor: false, cancellationToken);
                    }
                }

                foreach (var collectionId in submitted)
                {
                    await notifications.CollectionLinkSubmittedAsync(userId, collectionId, itemId, cancellationToken);
                }
            }

            await transaction.CommitAsync(cancellationToken);
        }

        if (notifications is not null)
        {
            // Committed: wake the notification worker (best-effort; the recovery Job covers a lost signal).
            await notifications.FlushSignalsAsync(cancellationToken);
        }

        return new SaveInboxEntryToCollectionsResult(
            save, new SaveInboxEntryCollectionsOutcome(added.Count, submitted.Count, alreadyIn, alreadyPending));
    }
}

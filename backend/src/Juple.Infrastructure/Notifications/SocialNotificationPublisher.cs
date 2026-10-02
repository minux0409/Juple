using Juple.Application.Notifications;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Notifications;

/// <summary>
/// Writes social events into the durable outbox (see ISocialNotificationPublisher): every method is ONE
/// small insert into notifications.NotificationEvents - constant cost whatever the Collection's size;
/// recipients, opt-outs and Push are decided later by NotificationEventStore and the delivery
/// processor. Inside BeginAtomicScopeAsync the insert shares the change's transaction; a repeat of an
/// already recorded event (same DedupKey - e.g. a second reaction change within the coalescing
/// window - see NotificationEventKeys) is simply not recorded again. After the commit, the new events'
/// ids are handed to INotificationSignal - an immediate, non-blocking hand-off to the in-process signal
/// channel; no network call happens on the request's path. Logs never include names, links or ids
/// beyond the notification type.
/// </summary>
public sealed class SocialNotificationPublisher(
    JupleDbContext dbContext,
    TimeProvider timeProvider,
    ILogger<SocialNotificationPublisher> logger,
    INotificationSignal? signal = null) : ISocialNotificationPublisher
{
    private readonly List<long> _unsignaled = [];

    public async Task<INotificationOutboxScope> BeginAtomicScopeAsync(CancellationToken cancellationToken = default) =>
        new OutboxScope(this, await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken));

    public async Task FlushSignalsAsync(CancellationToken cancellationToken = default)
    {
        if (_unsignaled.Count == 0 || signal is null)
        {
            _unsignaled.Clear();
            return;
        }

        var eventIds = _unsignaled.ToList();
        _unsignaled.Clear();
        // Not the request's token: the change is committed, so the signal is handed off even if the
        // client has just gone away. The hand-off itself never waits (see ChannelNotificationSignal).
        await signal.SignalEventsAsync(eventIds, CancellationToken.None);
    }

    public Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default) =>
        RecordAsync(new NotificationEvent(
            NotificationType.FriendRequestReceived, requesterUserId, recipientUserId, null, friendshipId, null, false, null,
            NotificationEventKeys.FriendRequestReceived(friendshipId), Now()), cancellationToken);

    public Task FriendRequestAnsweredAsync(long answererUserId, long requesterUserId, long friendshipId, CancellationToken cancellationToken = default) =>
        RecordAsync(new NotificationEvent(
            NotificationType.FriendRequestAnswered, answererUserId, requesterUserId, null, friendshipId, null, false, null,
            NotificationEventKeys.FriendRequestAnswered(friendshipId), Now()), cancellationToken);

    public Task CollectionInvitationReceivedAsync(long ownerUserId, long invitedUserId, long collectionId, long invitationId, CancellationToken cancellationToken = default) =>
        RecordAsync(new NotificationEvent(
            NotificationType.CollectionInvitationReceived, ownerUserId, invitedUserId, collectionId, invitationId, null, false, null,
            NotificationEventKeys.CollectionInvitationReceived(invitationId), Now()), cancellationToken);

    /// <summary>The Owner to tell (the inviter) is looked up when the event is processed.</summary>
    public Task CollectionInvitationAnsweredAsync(long inviteeUserId, long invitationId, CancellationToken cancellationToken = default) =>
        RecordAsync(new NotificationEvent(
            NotificationType.CollectionInvitationAnswered, inviteeUserId, null, null, invitationId, null, false, null,
            NotificationEventKeys.CollectionInvitationAnswered(invitationId), Now()), cancellationToken);

    /// <summary>One event per Collection (the ids are the caller's own choice, so bounded); repeats by the same person within the coalescing window are one.</summary>
    public async Task CollectionsChangedAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken = default)
    {
        var nowUtc = Now();
        foreach (var collectionId in collectionIds.Distinct())
        {
            await RecordAsync(new NotificationEvent(
                NotificationType.CollectionContentChanged, actorUserId, null, collectionId, null, null, false, null,
                NotificationEventKeys.CollectionContentChanged(collectionId, actorUserId, nowUtc), nowUtc), cancellationToken);
        }
    }

    /// <summary>One item-wide event; the processor expands it into the Item's shared Collections (an unknown number - never looked up here).</summary>
    public Task ItemCollectionsChangedAsync(long actorUserId, long itemId, CancellationToken cancellationToken = default)
    {
        var nowUtc = Now();
        return RecordAsync(new NotificationEvent(
            NotificationType.CollectionContentChanged, actorUserId, null, null, itemId, null, false, null,
            NotificationEventKeys.ItemCollectionsChanged(itemId, actorUserId, nowUtc), nowUtc), cancellationToken);
    }

    public Task CollectionItemsAddedAsync(long actorUserId, long collectionId, int itemCount, bool hideActor, CancellationToken cancellationToken = default) =>
        itemCount <= 0
            ? Task.CompletedTask
            : RecordAsync(new NotificationEvent(
                NotificationType.CollectionItemsAdded, actorUserId, null, collectionId, null, itemCount, hideActor, null, null, Now()), cancellationToken);

    /// <summary>Exactly a new link by its proposer - except that the approving Owner, who just did it, is not told either.</summary>
    public Task CollectionLinkApprovedAsync(long ownerUserId, long submitterUserId, long collectionId, bool hideActor, CancellationToken cancellationToken = default) =>
        RecordAsync(new NotificationEvent(
            NotificationType.CollectionItemsAdded, submitterUserId, null, collectionId, null, 1, hideActor, ownerUserId, null, Now()), cancellationToken);

    public Task CollectionItemReactionReceivedAsync(long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        RecordCollaborationAsync(NotificationType.CollectionItemReactionReceived, actorUserId, collectionId, itemId, cancellationToken);

    public Task CollectionItemCommentReceivedAsync(long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        RecordCollaborationAsync(NotificationType.CollectionItemCommentReceived, actorUserId, collectionId, itemId, cancellationToken);

    /// <summary>The proposer is kept on the event only to find the proposal - the Owner's notification never names them.</summary>
    public Task CollectionLinkSubmittedAsync(long submitterUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        RecordAsync(new NotificationEvent(
            NotificationType.CollectionLinkSubmissionReceived, submitterUserId, null, collectionId, itemId, null, true, null, null, Now()), cancellationToken);

    public Task CollectionLinkSubmissionAnsweredAsync(long submitterUserId, long collectionId, long submissionId, bool approved, CancellationToken cancellationToken = default)
    {
        var type = approved ? NotificationType.CollectionLinkSubmissionApproved : NotificationType.CollectionLinkSubmissionRejected;
        return RecordAsync(new NotificationEvent(
            type, null, submitterUserId, collectionId, submissionId, null, true, null,
            NotificationEventKeys.CollectionLinkSubmissionAnswered(submissionId, approved), Now()), cancellationToken);
    }

    private Task RecordCollaborationAsync(NotificationType type, long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken)
    {
        var nowUtc = Now();
        return RecordAsync(new NotificationEvent(
            type, actorUserId, null, collectionId, itemId, null, false, null,
            NotificationEventKeys.Collaboration(type, collectionId, itemId, actorUserId, nowUtc), nowUtc), cancellationToken);
    }

    private async Task RecordAsync(NotificationEvent notificationEvent, CancellationToken cancellationToken)
    {
        dbContext.NotificationEvents.Add(notificationEvent);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            _unsignaled.Add(notificationEvent.Id);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // The same event is recorded already (coalesced) - that one is enough. Only this statement
            // failed; the surrounding transaction and the change it carries are unaffected.
            logger.LogDebug("A {NotificationType} event was coalesced into one already recorded.", notificationEvent.Type);
        }
        finally
        {
            dbContext.Entry(notificationEvent).State = EntityState.Detached;
        }

        if (dbContext.Database.CurrentTransaction is null)
        {
            // Recorded outside any scope (committed on its own): signal it right away.
            await FlushSignalsAsync(cancellationToken);
        }
    }

    private DateTimeOffset Now() => timeProvider.GetUtcNow();

    private void DiscardAfterRollback()
    {
        _unsignaled.Clear();
        dbContext.ChangeTracker.Clear();
    }

    private sealed class OutboxScope(SocialNotificationPublisher publisher, StoreTransaction transaction) : INotificationOutboxScope
    {
        private bool _committed;

        public async Task CommitAsync(CancellationToken cancellationToken = default)
        {
            await transaction.CommitAsync(cancellationToken);
            _committed = true;
            if (!transaction.IsJoined)
            {
                // The events now exist - wake the worker. A joined scope leaves this to the owner of the
                // transaction, after ITS commit (FlushSignalsAsync).
                await publisher.FlushSignalsAsync(cancellationToken);
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (!_committed && !transaction.IsJoined)
            {
                // Rolled back: none of these events exist, and nothing saved here may stay tracked.
                publisher.DiscardAfterRollback();
            }

            await transaction.DisposeAsync();
        }
    }
}

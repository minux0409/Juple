using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.Submissions;

/// <summary>What adding a link to a Collection did: it is in the Collection now, or it waits for the Owner (승인 후 추가).</summary>
public enum CollectionLinkAddOutcome
{
    Added,
    Submitted,
}

/// <summary>
/// One link waiting for the Owner's approval, as the Owner reviews it: the shared fields of the
/// proposed link and who proposed it - by public identity for a member; never for someone who
/// proposed through the public link (Proposer null, ViaPublicShare true), exactly as their direct
/// adds are never named.
/// </summary>
public sealed record CollectionLinkSubmissionDto(
    long SubmissionId,
    string Url,
    string? Title,
    string? PreviewImageUrl,
    DateTimeOffset SubmittedAtUtc,
    bool ViaPublicShare,
    CollectionItemAdderDto? Proposer);

/// <summary>
/// One of the caller's OWN links still waiting for the Owner's approval (승인 후 추가), as its submitter
/// sees it: the link they proposed and when - never an internal id of anyone, nor any other proposer.
/// </summary>
public sealed record MyCollectionLinkSubmissionDto(
    long SubmissionId,
    string Url,
    string? Title,
    string? PreviewImageUrl,
    DateTimeOffset SubmittedAtUtc);

/// <summary>
/// Newest first; NextCursor = the last row's submissionId (null on the last page). TotalCount is how many
/// of the CALLER's OWN proposals wait in this Collection (one indexed count) - the number a public
/// submitter's screen shows, without any other count (nobody else's, never the Owner's queue).
/// </summary>
public sealed record MyCollectionLinkSubmissionPage(IReadOnlyList<MyCollectionLinkSubmissionDto> Items, long? NextCursor, int TotalCount = 0);

/// <summary>
/// One of the caller's OWN waiting proposals in the list across every Collection they have one in: the
/// proposal as MyCollectionLinkSubmissionDto plus, ONLY for a Collection the caller is a member of, its id and
/// name ("waiting in 위시리스트"). For a proposal made through a public link as a non-member - or whose link
/// was since revoked, or whose author left - CollectionId and CollectionName are null: it is shown as the
/// caller's own request (status, cancel) and nothing about the Collection is revealed merely because it exists.
/// </summary>
public sealed record MyCollectionLinkSubmissionWithCollectionDto(
    long SubmissionId,
    long? CollectionId,
    string? CollectionName,
    string Url,
    string? Title,
    string? PreviewImageUrl,
    DateTimeOffset SubmittedAtUtc);

/// <summary>Newest first; NextCursor = the last row's submissionId (null on the last page); TotalCount = all the caller's own waiting proposals in their member Collections.</summary>
public sealed record MyCollectionLinkSubmissionAcrossPage(IReadOnlyList<MyCollectionLinkSubmissionWithCollectionDto> Items, long? NextCursor, int TotalCount);

public sealed record CollectionLinkSubmissionPage(IReadOnlyList<CollectionLinkSubmissionDto> Items, long? NextCursor);

/// <summary>The approved proposal, for the notifications that follow it.</summary>
public sealed record ApprovedCollectionLinkSubmission(long CollectionId, long OwnerUserId, long SubmittedByUserId, bool ViaPublicShare);

/// <summary>A proposal its own submitter withdrew: which Collection it waited in and whose it is (the Owner, who is told only by a refresh).</summary>
public sealed record CancelledCollectionLinkSubmission(long CollectionId, long OwnerUserId);

public sealed class CollectionLinkSubmissionNotFoundException : Exception;

public interface ICollectionLinkSubmissionStore
{
    /// <summary>
    /// Records userId's proposal of their own live Item for this Collection, in one transaction under
    /// the Collection's row lock. The Collection's Owner never proposes - for them the Item is added
    /// directly (Added). A link (same URL) already in the Collection is refused
    /// (CollectionCollaborationConflictException LinkAlreadyInCollection), as is one already waiting
    /// (LinkAlreadyPending - also enforced by the unique index). ItemNotFoundException when the Item
    /// is not the caller's own live one. With requiredPublicId, the proposal comes through that public
    /// link: it must still be active and 승인 후 추가 at that moment (null if it is gone, and
    /// PublicShareReadOnlyException if it no longer takes proposals).
    /// </summary>
    Task<CollectionLinkAddOutcome?> SubmitAsync(
        long userId,
        long collectionId,
        long itemId,
        string? requiredPublicId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Oldest first (cursor = the last row's id), with each member proposer's public identity.</summary>
    Task<CollectionLinkSubmissionPage> ListAsync(long collectionId, long? afterSubmissionId, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Only userId's own waiting proposals in this Collection, newest first (cursor = the last row's id).
    /// A proposal waits exactly as long as its row exists - approving or rejecting deletes it - so this
    /// is "still pending" by construction.
    /// </summary>
    Task<MyCollectionLinkSubmissionPage> ListMineAsync(long collectionId, long userId, long? beforeSubmissionId, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// How many of userId's own proposals still wait, in ALL the Collections that exist - one set-based
    /// count, never one per Collection and never a page of rows. Proposals made through a public link as a
    /// non-member count too (and stay counted after the link is revoked): they are the caller's own
    /// requests and must stay findable and cancellable.
    /// </summary>
    Task<int> CountMineInSharedCollectionsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// userId's own waiting proposals across ALL the Collections they are a member of (the same set
    /// CountMineInSharedCollectionsAsync counts), newest first (cursor = the last row's id), each with its
    /// Collection's name - one joined, paged query plus one count, never one query per Collection.
    /// </summary>
    Task<MyCollectionLinkSubmissionAcrossPage> ListMineAcrossCollectionsAsync(long userId, long? beforeSubmissionId, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// In one transaction under the Collection's row lock: the proposal becomes an ordinary link of
    /// the proposer's Item (added by them, through the public link if it came that way) and is
    /// deleted. CollectionLinkSubmissionNotFoundException when it is not (or no longer) waiting -
    /// so approving twice adds once. If the link reached the Collection meanwhile, or the proposer's
    /// Item is gone, the proposal is deleted and a conflict (LinkAlreadyInCollection /
    /// SubmissionUnavailable) reported - nothing is added.
    /// </summary>
    Task<ApprovedCollectionLinkSubmission> ApproveAsync(long collectionId, long submissionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// The SUBMITTER withdraws their own still-waiting proposal - the one operation behind every
    /// cancel route (member and public link). In one transaction under the Collection's row lock (the
    /// same lock approve takes, so cancel and approve are strictly ordered): the proposal is deleted with
    /// a conditional predicate (Id AND SubmittedByUserId = userId - never anyone else's, never an
    /// already approved/rejected one, which no longer exists) and exactly the Owner's notification
    /// made for THIS proposal (Type CollectionLinkSubmissionReceived, SubjectId = the proposal id) is
    /// deleted with it, its Push deliveries cascading. Null when there is nothing of the caller's to
    /// cancel (unknown, someone else's, already answered, deleted Collection, or - with
    /// requiredCollectionId - in another Collection). No membership is created or changed and nothing
    /// is added to the Collection.
    /// </summary>
    Task<CancelledCollectionLinkSubmission?> CancelMineAsync(long userId, long submissionId, long? requiredCollectionId, CancellationToken cancellationToken = default);

    /// <summary>Deletes the proposal and returns who proposed it; null when it was not waiting (already approved or rejected).</summary>
    Task<long?> RejectAsync(long collectionId, long submissionId, CancellationToken cancellationToken = default);
}

public interface ICollectionLinkSubmissionService
{
    /// <summary>The caller's own waiting proposals across their shared Collections (the 공유 컬렉션 tab's number).</summary>
    Task<int> CountMineInSharedCollectionsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>The caller's own waiting proposals across their member Collections (the Collections screen's 내 승인 대기 popup). Only the caller's own rows - there is no way to ask for anyone else's.</summary>
    Task<MyCollectionLinkSubmissionAcrossPage> ListMineAcrossCollectionsAsync(long userId, long? cursor, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Cancels the caller's OWN waiting proposal (never a user id from the client): it leaves the Owner's
    /// queue, counts and Inbox, and nothing is sent to anyone as a result - this is not a rejection.
    /// CollectionLinkSubmissionNotFoundException (404, non-disclosing) for anything that is not the
    /// caller's own still-waiting proposal. With requiredCollectionId (the public route) it must be in
    /// that Collection.
    /// </summary>
    Task CancelMineAsync(long userId, long submissionId, long? requiredCollectionId, CancellationToken cancellationToken = default);

    /// <summary>The caller's own waiting proposals in this Collection (SubmitLink - i.e. a 승인 후 추가 member), behind the same content gate as the links.</summary>
    Task<MyCollectionLinkSubmissionPage> ListMineAsync(long userId, long collectionId, long? cursor, int limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task<CollectionLinkSubmissionPage> ListAsync(long userId, long collectionId, long? cursor, int limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task ApproveAsync(long userId, long collectionId, long submissionId, string? unlockToken, CancellationToken cancellationToken = default);

    Task RejectAsync(long userId, long collectionId, long submissionId, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// The Owner's 승인 대기 list: only the Owner may see, approve or reject proposals (ReviewSubmissions),
/// behind the same content gate as the links themselves (a locked Collection needs its grant).
/// Approving notifies like any new link - the proposer as the one who added it (unnamed if it came
/// through the public link), and never the approving Owner. The proposer is told the result either
/// way (approved or declined), never by whom. Changing the public link or anyone's role never
/// approves or deletes a waiting proposal on its own.
/// </summary>
public sealed class CollectionLinkSubmissionService(
    ICollectionAccessService accessService,
    ICollectionLinkSubmissionStore store,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : ICollectionLinkSubmissionService
{
    public const int MaxPageSize = 50;

    public async Task<CollectionLinkSubmissionPage> ListAsync(
        long userId,
        long collectionId,
        long? cursor,
        int limit,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ReviewSubmissions, unlockToken, cancellationToken);
        return await store.ListAsync(collectionId, cursor, Math.Clamp(limit, 1, MaxPageSize), cancellationToken);
    }

    public Task<int> CountMineInSharedCollectionsAsync(long userId, CancellationToken cancellationToken = default) =>
        store.CountMineInSharedCollectionsAsync(userId, cancellationToken);

    public Task<MyCollectionLinkSubmissionAcrossPage> ListMineAcrossCollectionsAsync(
        long userId,
        long? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        store.ListMineAcrossCollectionsAsync(userId, cursor, Math.Clamp(limit, 1, MaxPageSize), cancellationToken);

    public async Task CancelMineAsync(long userId, long submissionId, long? requiredCollectionId, CancellationToken cancellationToken = default)
    {
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var cancelled = await store.CancelMineAsync(userId, submissionId, requiredCollectionId, cancellationToken)
            ?? throw new CollectionLinkSubmissionNotFoundException();
        if (notifications is not null)
        {
            // Only a data-only refresh signal for the Collection (open Owner queue / counts / banners
            // re-check themselves) - no result notification: the requester withdrew it, it was not rejected.
            await notifications.CollectionsChangedAsync(userId, [cancelled.CollectionId], cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }

    public async Task<MyCollectionLinkSubmissionPage> ListMineAsync(
        long userId,
        long collectionId,
        long? cursor,
        int limit,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        // The caller is always the filter - there is no way to ask for anyone else's proposals - and the
        // Owner (who has no proposals of their own, they add directly) and Contributors/Viewers are refused.
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.SubmitLink, unlockToken, cancellationToken);
        return await store.ListMineAsync(collectionId, userId, cursor, Math.Clamp(limit, 1, MaxPageSize), cancellationToken);
    }

    public async Task ApproveAsync(
        long userId,
        long collectionId,
        long submissionId,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ReviewSubmissions, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        ApprovedCollectionLinkSubmission approved;
        try
        {
            approved = await store.ApproveAsync(collectionId, submissionId, timeProvider.GetUtcNow(), cancellationToken);
        }
        catch (CollectionCollaborationConflictException)
        {
            // The proposal could not become a link and was cleared - that clearing stands (committed,
            // with no notification) before the conflict is reported, exactly as without an outbox.
            await outbox.CommitAsync(cancellationToken);
            throw;
        }

        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
            await notifications.CollectionLinkApprovedAsync(
                approved.OwnerUserId, approved.SubmittedByUserId, collectionId, hideActor: approved.ViaPublicShare, cancellationToken);
            await notifications.CollectionLinkSubmissionAnsweredAsync(
                approved.SubmittedByUserId, collectionId, submissionId, approved: true, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }

    public async Task RejectAsync(
        long userId,
        long collectionId,
        long submissionId,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ReviewSubmissions, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        // Rejecting twice declines once: only the call that actually removed the proposal tells its proposer.
        if (await store.RejectAsync(collectionId, submissionId, cancellationToken) is { } submitterUserId && notifications is not null)
        {
            await notifications.CollectionLinkSubmissionAnsweredAsync(submitterUserId, collectionId, submissionId, approved: false, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }
}

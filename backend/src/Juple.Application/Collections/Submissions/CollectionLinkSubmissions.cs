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

public sealed record CollectionLinkSubmissionPage(IReadOnlyList<CollectionLinkSubmissionDto> Items, long? NextCursor);

/// <summary>The approved proposal, for the notifications that follow it.</summary>
public sealed record ApprovedCollectionLinkSubmission(long CollectionId, long OwnerUserId, long SubmittedByUserId, bool ViaPublicShare);

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
    /// In one transaction under the Collection's row lock: the proposal becomes an ordinary link of
    /// the proposer's Item (added by them, through the public link if it came that way) and is
    /// deleted. CollectionLinkSubmissionNotFoundException when it is not (or no longer) waiting -
    /// so approving twice adds once. If the link reached the Collection meanwhile, or the proposer's
    /// Item is gone, the proposal is deleted and a conflict (LinkAlreadyInCollection /
    /// SubmissionUnavailable) reported - nothing is added.
    /// </summary>
    Task<ApprovedCollectionLinkSubmission> ApproveAsync(long collectionId, long submissionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Deletes the proposal; false when it was not waiting (already approved or rejected).</summary>
    Task<bool> RejectAsync(long collectionId, long submissionId, CancellationToken cancellationToken = default);
}

public interface ICollectionLinkSubmissionService
{
    Task<CollectionLinkSubmissionPage> ListAsync(long userId, long collectionId, long? cursor, int limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task ApproveAsync(long userId, long collectionId, long submissionId, string? unlockToken, CancellationToken cancellationToken = default);

    Task RejectAsync(long userId, long collectionId, long submissionId, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// The Owner's 승인 대기 list: only the Owner may see, approve or reject proposals (ReviewSubmissions),
/// behind the same content gate as the links themselves (a locked Collection needs its grant).
/// Approving notifies like any new link - the proposer as the one who added it (unnamed if it came
/// through the public link), and never the approving Owner; rejecting tells nobody. Changing the
/// public link or anyone's role never approves or deletes a waiting proposal on its own.
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

    public async Task ApproveAsync(
        long userId,
        long collectionId,
        long submissionId,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ReviewSubmissions, unlockToken, cancellationToken);
        var approved = await store.ApproveAsync(collectionId, submissionId, timeProvider.GetUtcNow(), cancellationToken);
        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
            await notifications.CollectionLinkApprovedAsync(
                approved.OwnerUserId, approved.SubmittedByUserId, collectionId, hideActor: approved.ViaPublicShare, cancellationToken);
        }
    }

    public async Task RejectAsync(
        long userId,
        long collectionId,
        long submissionId,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ReviewSubmissions, unlockToken, cancellationToken);
        await store.RejectAsync(collectionId, submissionId, cancellationToken);
    }
}

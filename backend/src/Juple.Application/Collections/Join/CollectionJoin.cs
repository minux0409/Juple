using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.Join;

public static class CollectionJoinOutcomes
{
    public const string AlreadyMember = "alreadyMember";
    /// <summary>A public Collection was saved: the caller is now a Viewer.</summary>
    public const string Joined = "joined";
    public const string Requested = "requested";
    public const string AlreadyRequested = "alreadyRequested";
}

/// <summary>
/// What a join request came to. CollectionId and Role are filled only when the caller IS a member already - a request that is waiting
/// reveals nothing of the Collection.
/// </summary>
public sealed record CollectionJoinResultDto(string Outcome, long? CollectionId, string? Role);

/// <summary>One person waiting to join, as the Owner sees them: public identity only, never an internal user id.</summary>
public sealed record CollectionJoinRequestDto(
    long RequestId,
    string JupleId,
    string? DisplayName,
    string? ProfileImageUrl,
    string? ProfileImageVersion,
    DateTimeOffset RequestedAtUtc);

public sealed record CollectionJoinRequestPage(IReadOnlyList<CollectionJoinRequestDto> Items, long? NextCursor);

/// <summary>
/// The caller's OWN waiting join request, enough to draw a "승인 대기 중" placeholder in their Collections: the link it was made through
/// (to open its status), the Collection's name and look (icon, color and its own profile photo - never any content). It is not a membership.
/// </summary>
public sealed record MyCollectionJoinRequestDto(
    long RequestId,
    string PublicId,
    string Name,
    string Icon,
    string? Color,
    DateTimeOffset RequestedAtUtc,
    string? IconImageUrl = null,
    string? IconImageVersion = null);

public enum CollectionJoinStoreStatus
{
    /// <summary>No active link, or the Collection is gone.</summary>
    Unavailable,

    /// <summary>A request: the link's contents are public (save it instead). A save: the link is private. Either: the Collection cannot take new people.</summary>
    NotAllowed,
    AlreadyMember,
    /// <summary>A public Collection was saved just now.</summary>
    Joined,
    Requested,
    AlreadyRequested,
}

/// <param name="Role">The member's role when the caller already is one (the Owner included).</param>
public sealed record CollectionJoinStoreResult(
    CollectionJoinStoreStatus Status, long CollectionId = 0, long OwnerUserId = 0, string? Role = null, long RequestId = 0);

/// <summary>The request the Owner just answered: who asked, and the role they received (approval only - always Viewer).</summary>
public sealed record ResolvedCollectionJoinRequest(long RequesterUserId, string? Role, bool WasObsolete);

public sealed class CollectionJoinRequestNotFoundException : Exception;

public interface ICollectionJoinStore
{
    /// <summary>Records one waiting request for the caller through a PRIVATE link (a second tap is AlreadyRequested).</summary>
    Task<CollectionJoinStoreResult> RequestAsync(string publicId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// 컬렉션 추가 (저장): the caller explicitly joins a PUBLIC Collection through its active link - always as a Viewer, no approval. Under the
    /// Collection row lock: the link must still be active AND public (NotAllowed otherwise), an existing member is AlreadyMember (no second row),
    /// and the caller's own waiting request, if any, becomes Obsolete. Idempotent.
    /// </summary>
    Task<CollectionJoinStoreResult> SavePublicAsync(string publicId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<MyCollectionJoinRequestDto>> ListMineAsync(long userId, CancellationToken cancellationToken = default);

    Task<CollectionJoinRequestPage> ListPendingAsync(long collectionId, long? cursor, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Owner only (re-checked under the Collection lock): the request must still wait and the link must still be a private one; then the
    /// requester becomes a Viewer. A requester who is a member already just resolves it. CollectionJoinRequestNotFoundException when it
    /// no longer waits; a conflict joinNotAllowed when the link is gone or has become public.
    /// </summary>
    Task<ResolvedCollectionJoinRequest> ApproveAsync(long ownerUserId, long collectionId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Owner only: declines a waiting request. Null when it was not waiting (idempotent).</summary>
    Task<ResolvedCollectionJoinRequest?> RejectAsync(long ownerUserId, long collectionId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

public interface ICollectionJoinService
{
    /// <summary>Null for an unknown / revoked link. CollectionLockedException while the link's content gate is not passed (a member needs none).</summary>
    Task<CollectionJoinResultDto?> RequestAsync(long userId, string publicId, string? unlockToken, CancellationToken cancellationToken = default);

    /// <summary>Null for an unknown / revoked link. Same gate as RequestAsync; 409 joinNotAllowed unless the link is public.</summary>
    Task<CollectionJoinResultDto?> SavePublicAsync(long userId, string publicId, string? unlockToken, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<MyCollectionJoinRequestDto>> ListMineAsync(long userId, CancellationToken cancellationToken = default);

    Task<CollectionJoinRequestPage> ListAsync(long userId, long collectionId, long? cursor, int limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task ApproveAsync(long userId, long collectionId, long requestId, string? unlockToken, CancellationToken cancellationToken = default);

    Task RejectAsync(long userId, long collectionId, long requestId, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// Asking to join a Collection through its PRIVATE link (공용 컬렉션 OFF). The caller is always the authenticated user - never a body
/// field. The Collection's password (the link's content gate) must be proven first but never grants membership. A PUBLIC link is saved
/// explicitly (SavePublicAsync: Viewer at once); a PRIVATE one is requested and the Owner approves. Approving or declining
/// is the Owner's alone (ManageCollaborators), and an approved person always becomes a Viewer; the Owner may change that role later
/// like anyone's. Membership policy comes ONLY from the link's IsPublic - never from its Permission.
/// </summary>
public sealed class CollectionJoinService(
    ICollectionJoinStore store,
    IPublicCollectionShareStore shareStore,
    IPublicShareMembershipStore membershipStore,
    ICollectionAccessService accessService,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : ICollectionJoinService
{
    public const int MaxPageSize = 50;

    public async Task<CollectionJoinResultDto?> RequestAsync(long userId, string publicId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        var state = await shareStore.GetLinkStateAsync(publicId, cancellationToken);
        if (state is null)
        {
            return null;
        }

        var nowUtc = timeProvider.GetUtcNow();
        if (!PublicShareGate.IsUnlocked(state, unlockToken, unlockTokenProtector, nowUtc)
            && !(await membershipStore.GetAsync(publicId, userId, cancellationToken))?.IsMember is true)
        {
            // Password first, for a non-member - and the password itself never makes anybody a member.
            throw new CollectionLockedException();
        }

        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var result = await store.RequestAsync(publicId, userId, nowUtc, cancellationToken);

        switch (result.Status)
        {
            case CollectionJoinStoreStatus.Unavailable:
                return null;
            case CollectionJoinStoreStatus.NotAllowed:
                throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.JoinNotAllowed);
        }

        if (result.Status == CollectionJoinStoreStatus.Requested && notifications is not null)
        {
            await notifications.JoinRequestReceivedAsync(userId, result.OwnerUserId, result.CollectionId, result.RequestId, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
        return result.Status switch
        {
            CollectionJoinStoreStatus.AlreadyMember => new CollectionJoinResultDto(CollectionJoinOutcomes.AlreadyMember, result.CollectionId, result.Role),
            CollectionJoinStoreStatus.Requested => new CollectionJoinResultDto(CollectionJoinOutcomes.Requested, null, null),
            _ => new CollectionJoinResultDto(CollectionJoinOutcomes.AlreadyRequested, null, null),
        };
    }

    public async Task<CollectionJoinResultDto?> SavePublicAsync(long userId, string publicId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        var state = await shareStore.GetLinkStateAsync(publicId, cancellationToken);
        if (state is null)
        {
            return null;
        }

        var nowUtc = timeProvider.GetUtcNow();
        if (!PublicShareGate.IsUnlocked(state, unlockToken, unlockTokenProtector, nowUtc)
            && !(await membershipStore.GetAsync(publicId, userId, cancellationToken))?.IsMember is true)
        {
            // The password first - and it never saves anything by itself.
            throw new CollectionLockedException();
        }

        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var result = await store.SavePublicAsync(publicId, userId, nowUtc, cancellationToken);
        switch (result.Status)
        {
            case CollectionJoinStoreStatus.Unavailable:
                return null;
            case CollectionJoinStoreStatus.NotAllowed:
                throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.JoinNotAllowed);
        }

        if (result.Status == CollectionJoinStoreStatus.Joined && notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [result.CollectionId], cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
        return new CollectionJoinResultDto(
            result.Status == CollectionJoinStoreStatus.Joined ? CollectionJoinOutcomes.Joined : CollectionJoinOutcomes.AlreadyMember,
            result.CollectionId,
            result.Role);
    }

    public Task<IReadOnlyList<MyCollectionJoinRequestDto>> ListMineAsync(long userId, CancellationToken cancellationToken = default) =>
        store.ListMineAsync(userId, cancellationToken);

    public async Task<CollectionJoinRequestPage> ListAsync(
        long userId, long collectionId, long? cursor, int limit, string? unlockToken, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ManageCollaborators, unlockToken, cancellationToken);
        return await store.ListPendingAsync(collectionId, cursor, Math.Clamp(limit, 1, MaxPageSize), cancellationToken);
    }

    public async Task ApproveAsync(long userId, long collectionId, long requestId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ManageCollaborators, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var resolved = await store.ApproveAsync(userId, collectionId, requestId, timeProvider.GetUtcNow(), cancellationToken);
        if (notifications is not null && !resolved.WasObsolete)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
            await notifications.JoinRequestAnsweredAsync(userId, resolved.RequesterUserId, collectionId, requestId, approved: true, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }

    public async Task RejectAsync(long userId, long collectionId, long requestId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ManageCollaborators, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        // Declining twice declines once: only the call that actually resolved it tells the requester.
        if (await store.RejectAsync(userId, collectionId, requestId, timeProvider.GetUtcNow(), cancellationToken) is { } resolved && notifications is not null)
        {
            await notifications.JoinRequestAnsweredAsync(userId, resolved.RequesterUserId, collectionId, requestId, approved: false, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }
}

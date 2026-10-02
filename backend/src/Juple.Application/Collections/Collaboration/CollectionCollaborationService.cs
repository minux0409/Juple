using Juple.Application.Collections.Access;
using Juple.Application.Notifications;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Users;

namespace Juple.Application.Collections.Collaboration;

/// <summary>
/// Juple ID lookup → invitation → the invited user's own accept → collaborator. Typing a Juple ID
/// never grants anything by itself, and only the addressed user can accept (see the store).
/// </summary>
public sealed class CollectionCollaborationService(
    ICollectionAccessService accessService,
    IUserDirectoryStore userDirectory,
    ICollectionCollaborationStore collaborationStore,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null,
    IUserProfileImageStorage? profileImageStorage = null) : ICollectionCollaborationService
{
    public async Task<JupleIdLookupResult> LookupAsync(long userId, string? jupleId, CancellationToken cancellationToken = default)
    {
        var (targetUserId, publicCode) = await ResolveAsync(jupleId, cancellationToken);
        var image = await profileImageStorage.ResolveProfileImageAsync(
            targetUserId, await userDirectory.GetProfileImageBlobNameAsync(targetUserId, cancellationToken), cancellationToken);
        return new JupleIdLookupResult(
            publicCode, targetUserId == userId, await userDirectory.GetDisplayNameAsync(targetUserId, cancellationToken), image.Url, image.Version);
    }

    public async Task<string> GetMyJupleIdAsync(long userId, CancellationToken cancellationToken = default) =>
        await userDirectory.GetPublicCodeAsync(userId, cancellationToken)
        ?? throw new InvalidOperationException("Every user has a Juple ID.");

    public async Task<CollectionPendingInvitationDto> InviteAsync(
        long userId,
        long collectionId,
        string? jupleId,
        CollectionCollaboratorRole role = CollectionCollaboratorRole.Contributor,
        CancellationToken cancellationToken = default)
    {
        var access = await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageCollaborators, cancellationToken);
        RequireKnownRole(role);

        // The legacy mode only keeps the recipients this Collection already had when share passwords
        // were introduced; a new one is never handed the Owner's lock password. The Owner first sets
        // the Collection's own share password or turns share-password protection off - both leave
        // the legacy mode for good, so this check cannot go stale.
        if (access.SharePasswordMode == CollectionSharePasswordMode.LegacyCommonLock)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.SharePasswordMigrationRequired);
        }

        var (invitedUserId, _) = await ResolveAsync(jupleId, cancellationToken);
        if (invitedUserId == userId)
        {
            throw new InvalidCollectionException("jupleId", "You cannot invite yourself.");
        }

        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var invitation = await collaborationStore.CreateInvitationAsync(
            collectionId, userId, invitedUserId, timeProvider.GetUtcNow(), role, cancellationToken);
        if (notifications is not null)
        {
            await notifications.CollectionInvitationReceivedAsync(userId, invitedUserId, collectionId, invitation.InvitationId, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
        return invitation;
    }

    public async Task RevokeInvitationAsync(
        long userId,
        long collectionId,
        long invitationId,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageCollaborators, cancellationToken);
        await collaborationStore.RevokeInvitationAsync(collectionId, invitationId, timeProvider.GetUtcNow(), cancellationToken);
    }

    public async Task<CollectionCollaborationOverview> GetOverviewAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageCollaborators, cancellationToken);
        return await collaborationStore.GetOverviewAsync(collectionId, timeProvider.GetUtcNow(), cancellationToken);
    }

    public async Task RemoveCollaboratorAsync(
        long userId,
        long collectionId,
        string? jupleId,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageCollaborators, cancellationToken);
        if (!UserPublicCode.TryNormalize(jupleId, out var publicCode)
            || await userDirectory.FindUserIdByPublicCodeAsync(publicCode, cancellationToken) is not { } collaboratorUserId)
        {
            throw new CollectionCollaboratorNotFoundException();
        }

        await collaborationStore.RemoveCollaboratorAsync(collectionId, collaboratorUserId, cancellationToken);
    }

    public async Task ChangeInvitationRoleAsync(
        long userId,
        long collectionId,
        long invitationId,
        CollectionCollaboratorRole role,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageCollaborators, cancellationToken);
        RequireKnownRole(role);
        await collaborationStore.ChangeInvitationRoleAsync(
            collectionId, userId, invitationId, role, timeProvider.GetUtcNow(), cancellationToken);
    }

    public async Task ChangeCollaboratorRoleAsync(
        long userId,
        long collectionId,
        string? jupleId,
        CollectionCollaboratorRole role,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageCollaborators, cancellationToken);
        RequireKnownRole(role);
        if (!UserPublicCode.TryNormalize(jupleId, out var publicCode)
            || await userDirectory.FindUserIdByPublicCodeAsync(publicCode, cancellationToken) is not { } collaboratorUserId)
        {
            throw new CollectionCollaboratorNotFoundException();
        }

        await collaborationStore.ChangeCollaboratorRoleAsync(collectionId, userId, collaboratorUserId, role, cancellationToken);
    }

    public async Task<CollectionParticipantsDto> GetParticipantsAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        // Membership is metadata like the Collection card itself - visible to every member without
        // an unlock grant; only the Owner additionally sees (and may manage) pending invitations.
        var access = await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);
        var participants = await collaborationStore.GetParticipantsAsync(
            collectionId, userId, includePending: access.IsOwner, timeProvider.GetUtcNow(), cancellationToken);
        return participants with { CanManage = access.IsOwner };
    }

    public Task<IReadOnlyList<ReceivedCollectionInvitationDto>> ListReceivedInvitationsAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        collaborationStore.ListReceivedAsync(userId, timeProvider.GetUtcNow(), cancellationToken);

    /// <summary>The Owner is told (data-only) so an open Share screen moves the person from 초대 대기 to 공유 중.</summary>
    public async Task AcceptInvitationAsync(long userId, long invitationId, CancellationToken cancellationToken = default)
    {
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        try
        {
            await collaborationStore.AcceptAsync(userId, invitationId, timeProvider.GetUtcNow(), cancellationToken);
        }
        catch (CollectionCollaborationConflictException)
        {
            // An invitation found expired is marked so before the conflict is reported - that write
            // stands (committed, with no notification), exactly as without an outbox.
            await outbox.CommitAsync(cancellationToken);
            throw;
        }

        if (notifications is not null)
        {
            await notifications.CollectionInvitationAnsweredAsync(userId, invitationId, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }

    public async Task DeclineInvitationAsync(long userId, long invitationId, CancellationToken cancellationToken = default)
    {
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        await collaborationStore.DeclineAsync(userId, invitationId, timeProvider.GetUtcNow(), cancellationToken);
        if (notifications is not null)
        {
            await notifications.CollectionInvitationAnsweredAsync(userId, invitationId, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }

    private static void RequireKnownRole(CollectionCollaboratorRole role)
    {
        if (!Enum.IsDefined(role))
        {
            throw new InvalidCollectionException("role", "Unknown role.");
        }
    }

    private async Task<(long UserId, string PublicCode)> ResolveAsync(string? jupleId, CancellationToken cancellationToken)
    {
        if (!UserPublicCode.TryNormalize(jupleId, out var publicCode)
            || await userDirectory.FindUserIdByPublicCodeAsync(publicCode, cancellationToken) is not { } userId)
        {
            throw new JupleIdNotFoundException();
        }

        return (userId, publicCode);
    }
}

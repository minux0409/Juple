using Juple.Application.Collections;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionCollaborationStore(
    JupleDbContext dbContext,
    IUserProfileImageStorage? profileImageStorage = null) : ICollectionCollaborationStore
{
    public async Task<CollectionPendingInvitationDto> CreateInvitationAsync(
        long collectionId,
        long ownerUserId,
        long invitedUserId,
        DateTimeOffset nowUtc,
        CollectionCollaboratorRole role = CollectionCollaboratorRole.Contributor,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) != ownerUserId)
        {
            throw new CollectionNotFoundException();
        }

        await RequireRoleMatchesPublicShareAsync(collectionId, role, cancellationToken);

        if (await dbContext.CollectionCollaborators.AnyAsync(
                collaborator => collaborator.CollectionId == collectionId && collaborator.UserId == invitedUserId,
                cancellationToken))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.AlreadyCollaborator);
        }

        var open = await dbContext.CollectionInvitations
            .Where(invitation => invitation.CollectionId == collectionId
                && invitation.InvitedUserId == invitedUserId
                && invitation.Status == CollectionInvitationStatus.Pending)
            .ToListAsync(cancellationToken);
        foreach (var stale in open)
        {
            if (stale.IsPendingAt(nowUtc))
            {
                throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationPending);
            }

            // Frees the filtered unique index for the new invitation below.
            stale.MarkExpired(nowUtc);
        }

        var created = new CollectionInvitation(collectionId, invitedUserId, ownerUserId, role, nowUtc);
        dbContext.CollectionInvitations.Add(created);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationPending);
        }

        var invited = await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == invitedUserId)
            .Select(user => new { user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
            .FirstAsync(cancellationToken);
        var invitedImage = await profileImageStorage.ResolveProfileImageAsync(invitedUserId, invited.ProfileImageBlobName, cancellationToken);
        return new CollectionPendingInvitationDto(
            created.Id, invited.PublicCode, created.Role.ToString(), created.CreatedAtUtc, created.ExpiresAtUtc, invited.DisplayName, invitedImage.Url, invitedImage.Version);
    }

    public async Task RevokeInvitationAsync(
        long collectionId,
        long invitationId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var invitation = await dbContext.CollectionInvitations.FirstOrDefaultAsync(
                entry => entry.Id == invitationId && entry.CollectionId == collectionId, cancellationToken)
            ?? throw new CollectionInvitationNotFoundException();
        if (invitation.Status != CollectionInvitationStatus.Pending)
        {
            return;
        }

        invitation.Revoke(nowUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Accepted/declined concurrently - that response wins; the Owner can remove the
            // collaborator explicitly if it was an acceptance.
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }
    }

    public async Task ChangeInvitationRoleAsync(
        long collectionId,
        long ownerUserId,
        long invitationId,
        CollectionCollaboratorRole role,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) != ownerUserId)
        {
            throw new CollectionNotFoundException();
        }

        var invitation = await dbContext.CollectionInvitations.FirstOrDefaultAsync(
                entry => entry.Id == invitationId && entry.CollectionId == collectionId, cancellationToken)
            ?? throw new CollectionInvitationNotFoundException();
        await dbContext.Entry(invitation).ReloadAsync(cancellationToken);
        if (!invitation.IsPendingAt(nowUtc))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }

        if (invitation.Role == role)
        {
            return;
        }

        await RequireRoleMatchesPublicShareAsync(collectionId, role, cancellationToken);
        invitation.ChangeRole(role, nowUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Accepted/declined between our read and write - that response wins.
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }
    }

    public async Task ChangeCollaboratorRoleAsync(
        long collectionId,
        long ownerUserId,
        long collaboratorUserId,
        CollectionCollaboratorRole role,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) != ownerUserId)
        {
            throw new CollectionNotFoundException();
        }

        var collaborator = await dbContext.CollectionCollaborators.FirstOrDefaultAsync(
                entry => entry.CollectionId == collectionId && entry.UserId == collaboratorUserId, cancellationToken)
            ?? throw new CollectionCollaboratorNotFoundException();
        if (collaborator.Role == role)
        {
            return;
        }

        await RequireRoleMatchesPublicShareAsync(collectionId, role, cancellationToken);
        collaborator.ChangeRole(role);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// While the public link is active its permission is the minimum a specific person may have (see
    /// PublicShareRoles): under 보기만 either role, under 링크 추가 only 링크 추가. Checked under the
    /// Collection row lock the caller holds; nothing is ever changed automatically to make it fit.
    /// </summary>
    private async Task RequireRoleMatchesPublicShareAsync(
        long collectionId,
        CollectionCollaboratorRole role,
        CancellationToken cancellationToken)
    {
        var activePermission = await dbContext.CollectionShares
            .Where(share => share.CollectionId == collectionId && share.IsActive)
            .Select(share => (CollectionSharePermission?)share.Permission)
            .FirstOrDefaultAsync(cancellationToken);
        if (activePermission is { } permission && !PublicShareRoles.Allows(permission, role))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.PublicShareActive);
        }
    }

    public async Task<CollectionCollaborationOverview> GetOverviewAsync(
        long collectionId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var collaborators = await (
            from collaborator in dbContext.CollectionCollaborators.AsNoTracking()
            where collaborator.CollectionId == collectionId
            join user in dbContext.Users.AsNoTracking() on collaborator.UserId equals user.Id
            orderby collaborator.CreatedAtUtc, collaborator.Id
            select new { UserId = user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName, collaborator.Role, collaborator.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        var pending = await (
            from invitation in dbContext.CollectionInvitations.AsNoTracking()
            where invitation.CollectionId == collectionId
                && invitation.Status == CollectionInvitationStatus.Pending
                && invitation.ExpiresAtUtc > nowUtc
            join user in dbContext.Users.AsNoTracking() on invitation.InvitedUserId equals user.Id
            orderby invitation.CreatedAtUtc, invitation.Id
            select new { invitation.Id, UserId = user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName, invitation.Role, invitation.CreatedAtUtc, invitation.ExpiresAtUtc })
            .ToListAsync(cancellationToken);

        // Two queries above for everyone; each photo below is a local signing step, never a DB call.
        var collaboratorDtos = new List<CollectionCollaboratorDto>(collaborators.Count);
        foreach (var row in collaborators)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(row.UserId, row.ProfileImageBlobName, cancellationToken);
            collaboratorDtos.Add(new CollectionCollaboratorDto(
                row.PublicCode, row.Role.ToString(), row.CreatedAtUtc, row.DisplayName, image.Url, image.Version));
        }

        var pendingDtos = new List<CollectionPendingInvitationDto>(pending.Count);
        foreach (var row in pending)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(row.UserId, row.ProfileImageBlobName, cancellationToken);
            pendingDtos.Add(new CollectionPendingInvitationDto(
                row.Id, row.PublicCode, row.Role.ToString(), row.CreatedAtUtc, row.ExpiresAtUtc, row.DisplayName, image.Url, image.Version));
        }

        return new CollectionCollaborationOverview(collaboratorDtos, pendingDtos);
    }

    public async Task<CollectionParticipantsDto> GetParticipantsAsync(
        long collectionId,
        long callerUserId,
        bool includePending,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var owner = await (
            from collection in dbContext.Collections.AsNoTracking()
            where collection.Id == collectionId
            join user in dbContext.Users.AsNoTracking() on collection.UserId equals user.Id
            select new { user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new CollectionNotFoundException();

        var members = await (
            from collaborator in dbContext.CollectionCollaborators.AsNoTracking()
            where collaborator.CollectionId == collectionId
            join user in dbContext.Users.AsNoTracking() on collaborator.UserId equals user.Id
            orderby collaborator.CreatedAtUtc, collaborator.Id
            select new { user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName, collaborator.Role })
            .ToListAsync(cancellationToken);

        var ownerImage = await profileImageStorage.ResolveProfileImageAsync(owner.Id, owner.ProfileImageBlobName, cancellationToken);
        var participants = new List<CollectionParticipantDto>
        {
            new(owner.PublicCode, owner.DisplayName, CollectionDtoAccessRoles.Owner, owner.Id == callerUserId, ownerImage.Url, ownerImage.Version),
        };
        foreach (var member in members)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(member.Id, member.ProfileImageBlobName, cancellationToken);
            participants.Add(new CollectionParticipantDto(
                member.PublicCode, member.DisplayName, CollectionDtoAccessRoles.ForCollaborator(member.Role), member.Id == callerUserId, image.Url, image.Version));
        }

        var pending = includePending
            ? (await GetOverviewAsync(collectionId, nowUtc, cancellationToken)).PendingInvitations
            : [];
        return new CollectionParticipantsDto(participants, pending, CanManage: includePending);
    }

    public async Task RemoveCollaboratorAsync(
        long collectionId,
        long collaboratorUserId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var collaborator = await dbContext.CollectionCollaborators.FirstOrDefaultAsync(
                entry => entry.CollectionId == collectionId && entry.UserId == collaboratorUserId, cancellationToken)
            ?? throw new CollectionCollaboratorNotFoundException();

        // Exactly the links this person added to THIS Collection - their Items themselves, their
        // Home/History, and their memberships in any other Collection are untouched.
        await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId && membership.AddedByUserId == collaboratorUserId)
            .ExecuteDeleteAsync(cancellationToken);

        // Their emoji reactions on this Collection's links - they can no longer see it.
        await dbContext.CollectionItemReactions
            .Where(reaction => reaction.CollectionId == collectionId && reaction.UserId == collaboratorUserId)
            .ExecuteDeleteAsync(cancellationToken);

        // Their personal favorite mark on a Collection they can no longer access.
        await dbContext.CollectionFavorites
            .Where(favorite => favorite.CollectionId == collectionId && favorite.UserId == collaboratorUserId)
            .ExecuteDeleteAsync(cancellationToken);

        dbContext.CollectionCollaborators.Remove(collaborator);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ReceivedCollectionInvitationDto>> ListReceivedAsync(
        long userId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var rows = await (
            from invitation in dbContext.CollectionInvitations.AsNoTracking()
            where invitation.InvitedUserId == userId
                && invitation.Status == CollectionInvitationStatus.Pending
                && invitation.ExpiresAtUtc > nowUtc
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                on invitation.CollectionId equals collection.Id
            join owner in dbContext.Users.AsNoTracking() on collection.UserId equals owner.Id
            orderby invitation.CreatedAtUtc descending, invitation.Id descending
            select new
            {
                invitation.Id,
                invitation.CollectionId,
                collection.Name,
                collection.Icon,
                collection.Color,
                OwnerPublicCode = owner.PublicCode,
                OwnerUserId = owner.Id,
                OwnerDisplayName = owner.DisplayName,
                OwnerProfileImageBlobName = owner.ProfileImageBlobName,
                invitation.Role,
                invitation.CreatedAtUtc,
                invitation.ExpiresAtUtc,
            })
            .ToListAsync(cancellationToken);

        var invitations = new List<ReceivedCollectionInvitationDto>(rows.Count);
        foreach (var row in rows)
        {
            var ownerImage = await profileImageStorage.ResolveProfileImageAsync(row.OwnerUserId, row.OwnerProfileImageBlobName, cancellationToken);
            invitations.Add(new ReceivedCollectionInvitationDto(
                row.Id, row.CollectionId, row.Name, row.Icon.ToString(), row.Color, row.OwnerPublicCode,
                row.Role.ToString(), row.CreatedAtUtc, row.ExpiresAtUtc, row.OwnerDisplayName, ownerImage.Url, ownerImage.Version));
        }

        return invitations;
    }

    public async Task AcceptAsync(long userId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        // Addressed-to check first: an invitation for anyone else is simply "not found".
        var collectionId = await dbContext.CollectionInvitations
                .AsNoTracking()
                .Where(invitation => invitation.Id == invitationId && invitation.InvitedUserId == userId)
                .Select(invitation => (long?)invitation.CollectionId)
                .FirstOrDefaultAsync(cancellationToken)
            ?? throw new CollectionInvitationNotFoundException();

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) is null)
        {
            throw new CollectionInvitationNotFoundException();
        }

        var invitation = await dbContext.CollectionInvitations.FirstAsync(entry => entry.Id == invitationId, cancellationToken);
        // Decide on the row as it is now, under the Collection lock - never on a copy this context
        // may have tracked before the lock was taken.
        await dbContext.Entry(invitation).ReloadAsync(cancellationToken);
        var alreadyMember = await dbContext.CollectionCollaborators.AnyAsync(
            collaborator => collaborator.CollectionId == collectionId && collaborator.UserId == userId, cancellationToken);

        if (invitation.Status == CollectionInvitationStatus.Accepted)
        {
            // Idempotent replay (double tap, retried request) - but not a way back in after removal.
            if (alreadyMember)
            {
                return;
            }

            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }

        if (!invitation.IsPendingAt(nowUtc))
        {
            if (invitation.Status == CollectionInvitationStatus.Pending)
            {
                invitation.MarkExpired(nowUtc);
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }

            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }

        await RequireRoleMatchesPublicShareAsync(collectionId, invitation.Role, cancellationToken);

        invitation.Accept(nowUtc);
        if (!alreadyMember)
        {
            dbContext.CollectionCollaborators.Add(new CollectionCollaborator(
                collectionId, userId, invitation.Role, invitation.InvitedByUserId, nowUtc));
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Revoked/declined between our read and write.
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }
    }

    public async Task DeclineAsync(long userId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var invitation = await dbContext.CollectionInvitations.FirstOrDefaultAsync(
                entry => entry.Id == invitationId && entry.InvitedUserId == userId, cancellationToken)
            ?? throw new CollectionInvitationNotFoundException();

        if (invitation.Status == CollectionInvitationStatus.Declined)
        {
            return;
        }

        if (!invitation.IsPendingAt(nowUtc))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }

        invitation.Decline(nowUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.InvitationNotPending);
        }
    }
}

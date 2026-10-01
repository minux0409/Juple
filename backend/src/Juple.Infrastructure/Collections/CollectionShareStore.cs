using Juple.Application.Collections;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionShareStore(JupleDbContext dbContext) : ICollectionShareStore, ICollectionShareLinkReader
{
    public Task<string?> GetActivePublicIdAsync(long collectionId, CancellationToken cancellationToken = default) =>
        dbContext.CollectionShares
            .AsNoTracking()
            .Where(share => share.CollectionId == collectionId
                && share.IsActive
                && dbContext.Collections.Any(collection => collection.Id == collectionId && collection.DeletedAtUtc == null))
            .Select(share => share.PublicId)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        string candidatePublicId,
        DateTimeOffset enabledAtUtc,
        CollectionSharePermission permission = CollectionSharePermission.Read,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Row lock first (see CollectionRowLock): a concurrent invitation/accept on this same
        // Collection is serialized against this check-then-insert.
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken);
        if (ownerUserId != userId)
        {
            throw new CollectionNotFoundException();
        }

        var existing = await dbContext.CollectionShares
            .AsNoTracking()
            .Where(share => share.CollectionId == collectionId && share.IsActive)
            .FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            return ToDto(existing);
        }

        // A new public link is a new recipient: never under the legacy mode, which only keeps the
        // Owner's lock password for the recipients this Collection already had (see
        // CollectionSharePasswordMode.LegacyCommonLock). An already-active link above is not new.
        if (await dbContext.CollectionSharePasswords.AsNoTracking().AnyAsync(
                sharePassword => sharePassword.CollectionId == collectionId
                    && sharePassword.Mode == CollectionSharePasswordMode.LegacyCommonLock,
                cancellationToken))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.SharePasswordMigrationRequired);
        }

        if (raiseLowerRoles)
        {
            await RaiseEveryoneToMinimumAsync(collectionId, permission, enabledAtUtc, cancellationToken);
        }
        else
        {
            await RequireEveryoneMatchesAsync(collectionId, permission, enabledAtUtc, cancellationToken);
        }

        var share = new CollectionShare(collectionId, candidatePublicId, enabledAtUtc);
        share.SetPermission(permission, enabledAtUtc);
        dbContext.CollectionShares.Add(share);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            // A pending invitation answered between our read and write (only possible while raising roles).
            throw new CollectionConcurrencyException(exception);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent EnableAsync call for this same Collection already won the race on
            // UX_CollectionShares_CollectionId_Active - re-read and return that winner instead of
            // ever persisting a second active share for this Collection.
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            var winner = await dbContext.CollectionShares
                .AsNoTracking()
                .Where(s => s.CollectionId == collectionId && s.IsActive)
                .FirstAsync(cancellationToken);
            return ToDto(winner);
        }

        return ToDto(share);
    }

    public async Task<CollectionShareDto?> GetActiveAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (!collectionOwned)
        {
            throw new CollectionNotFoundException();
        }

        var share = await dbContext.CollectionShares
            .AsNoTracking()
            .Where(s => s.CollectionId == collectionId && s.IsActive)
            .FirstOrDefaultAsync(cancellationToken);

        return share is null ? null : ToDto(share);
    }

    public async Task RevokeAsync(
        long userId,
        long collectionId,
        DateTimeOffset revokedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (!collectionOwned)
        {
            throw new CollectionNotFoundException();
        }

        var share = await dbContext.CollectionShares
            .FirstOrDefaultAsync(s => s.CollectionId == collectionId && s.IsActive, cancellationToken);
        if (share is null)
        {
            return;
        }

        share.Revoke(revokedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A concurrent Revoke already got there first - the desired end state (unshared) was
            // already reached.
        }
    }

    public async Task<CollectionShareDto?> SetPermissionAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission,
        DateTimeOffset updatedAtUtc,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default)
    {
        // Same row lock as enabling and as every invite/role change, so the check below cannot race one.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) != userId)
        {
            throw new CollectionNotFoundException();
        }

        var share = await dbContext.CollectionShares
            .FirstOrDefaultAsync(s => s.CollectionId == collectionId && s.IsActive, cancellationToken);
        if (share is null)
        {
            return null;
        }

        if (share.Permission != permission)
        {
            if (raiseLowerRoles)
            {
                await RaiseEveryoneToMinimumAsync(collectionId, permission, updatedAtUtc, cancellationToken);
            }
            else
            {
                await RequireEveryoneMatchesAsync(collectionId, permission, updatedAtUtc, cancellationToken);
            }
        }

        share.SetPermission(permission, updatedAtUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        return ToDto(share);
    }

    /// <summary>
    /// The public link may be on only while every member and every still-pending invitation has at
    /// least its permission's role (see PublicShareRoles) - so 읽기 전용 never conflicts, 승인 후 추가
    /// is refused while anyone is still 읽기 전용, and 링크 추가 while anyone is below it. Never fixed
    /// up by changing anyone's role automatically; the Owner raises them first.
    /// </summary>
    private async Task RequireEveryoneMatchesAsync(
        long collectionId,
        CollectionSharePermission permission,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var belowBaseline = PublicShareRoles.RolesBelow(permission);
        if (belowBaseline.Count == 0)
        {
            return;
        }

        var mismatch = await dbContext.CollectionCollaborators
                .AnyAsync(collaborator => collaborator.CollectionId == collectionId && belowBaseline.Contains(collaborator.Role), cancellationToken)
            || await dbContext.CollectionInvitations
                .AnyAsync(invitation => invitation.CollectionId == collectionId
                    && belowBaseline.Contains(invitation.Role)
                    && invitation.Status == CollectionInvitationStatus.Pending
                    && invitation.ExpiresAtUtc > nowUtc, cancellationToken);
        if (mismatch)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.PublicSharePermissionMismatch);
        }
    }

    /// <summary>
    /// The Owner-confirmed alternative to RequireEveryoneMatchesAsync: every member and every
    /// still-pending invitation below this permission's minimum role is raised to that minimum (never
    /// lowered, never touching anyone already at or above it). Runs under the Collection row lock and
    /// is saved in the caller's transaction together with the permission change, so either both
    /// happen or neither does.
    /// </summary>
    private async Task RaiseEveryoneToMinimumAsync(
        long collectionId,
        CollectionSharePermission permission,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var belowBaseline = PublicShareRoles.RolesBelow(permission);
        if (belowBaseline.Count == 0)
        {
            return;
        }

        var minimum = PublicShareRoles.MinimumFor(permission);
        var collaborators = await dbContext.CollectionCollaborators
            .Where(collaborator => collaborator.CollectionId == collectionId && belowBaseline.Contains(collaborator.Role))
            .ToListAsync(cancellationToken);
        foreach (var collaborator in collaborators)
        {
            collaborator.ChangeRole(minimum);
        }

        var invitations = await dbContext.CollectionInvitations
            .Where(invitation => invitation.CollectionId == collectionId
                && belowBaseline.Contains(invitation.Role)
                && invitation.Status == CollectionInvitationStatus.Pending
                && invitation.ExpiresAtUtc > nowUtc)
            .ToListAsync(cancellationToken);
        foreach (var invitation in invitations)
        {
            invitation.ChangeRole(minimum, nowUtc);
        }
    }

    private static CollectionShareDto ToDto(CollectionShare share) =>
        new(share.CollectionId, share.PublicId, share.CreatedAtUtc, share.Permission);
}

using Juple.Application.Collections;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionShareStore(JupleDbContext dbContext) : ICollectionShareStore
{
    public async Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        string candidatePublicId,
        DateTimeOffset enabledAtUtc,
        CollectionSharePermission permission = CollectionSharePermission.Read,
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

        // Public sharing and collaboration (Contributors) are mutually exclusive. A pending
        // Contributor invitation counts as collaboration already started - otherwise accepting it
        // later would silently create a collaborative Collection that is also public. Viewers (and
        // pending Viewer invitations) add nothing, so they coexist with the public link. Nothing is
        // auto-disabled; the Owner must revoke/remove first.
        var collaborative = await dbContext.CollectionCollaborators
                .AnyAsync(collaborator => collaborator.CollectionId == collectionId
                    && collaborator.Role == CollectionCollaboratorRole.Contributor, cancellationToken)
            || await dbContext.CollectionInvitations
                .AnyAsync(invitation => invitation.CollectionId == collectionId
                    && invitation.Role == CollectionCollaboratorRole.Contributor
                    && invitation.Status == CollectionInvitationStatus.Pending
                    && invitation.ExpiresAtUtc > enabledAtUtc, cancellationToken);
        if (collaborative)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.CollaborationActive);
        }

        var share = new CollectionShare(collectionId, candidatePublicId, enabledAtUtc);
        share.SetPermission(permission, enabledAtUtc);
        dbContext.CollectionShares.Add(share);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
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
            return null;
        }

        share.SetPermission(permission, updatedAtUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        return ToDto(share);
    }

    private static CollectionShareDto ToDto(CollectionShare share) =>
        new(share.CollectionId, share.PublicId, share.CreatedAtUtc, share.Permission);
}

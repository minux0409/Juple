using Juple.Application.Collections.Join;
using Juple.Application.Collections.Public;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// Asking to join a Collection through its PRIVATE link (공용 컬렉션 OFF). Every decision is made under the Collection row lock (the same
/// lock invitations, role changes and share changes take), on the link as it is THEN: still active and still private. The membership an
/// approval creates is the ordinary CollectionCollaborator row - unique per (Collection, user) - so a double tap, a retry or a race with an
/// invitation can never create two. Membership policy comes ONLY from IsPublic: a public link is saved explicitly (Viewer at once), a
/// private one is requested and the Owner approves (or the person is invited). Never derived from the link's Permission.
/// </summary>
public sealed class CollectionJoinStore(
    JupleDbContext dbContext,
    IUserProfileImageStorage? profileImageStorage = null,
    Juple.Application.Collections.SetCollectionIconImage.ICollectionIconImageStorage? iconImageStorage = null) : ICollectionJoinStore
{
    /// <summary>What every approval AND every public save grants: the Owner may change the role later like anyone's. Never derived from the link's permission.</summary>
    private const CollectionCollaboratorRole ApprovedRole = CollectionCollaboratorRole.Viewer;

    public async Task<CollectionJoinStoreResult> RequestAsync(string publicId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var collectionId = await dbContext.CollectionShares.AsNoTracking()
            .Where(share => share.PublicId == publicId && share.IsActive)
            .Select(share => (long?)share.CollectionId)
            .FirstOrDefaultAsync(cancellationToken);
        if (collectionId is null)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Unavailable);
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId.Value, cancellationToken);
        if (ownerUserId is null)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Unavailable);
        }

        // The link as it is now, under the lock - never a value read before it.
        var isPublic = await dbContext.CollectionShares.AsNoTracking()
            .Where(candidate => candidate.CollectionId == collectionId.Value && candidate.IsActive && candidate.PublicId == publicId)
            .Select(candidate => (bool?)candidate.IsPublic)
            .FirstOrDefaultAsync(cancellationToken);
        if (isPublic is null)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Unavailable);
        }

        if (ownerUserId == userId)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, collectionId.Value, ownerUserId.Value, "owner");
        }

        var existingRole = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => collaborator.CollectionId == collectionId.Value && collaborator.UserId == userId)
            .Select(collaborator => (CollectionCollaboratorRole?)collaborator.Role)
            .FirstOrDefaultAsync(cancellationToken);
        if (existingRole is { } alreadyRole)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, collectionId.Value, ownerUserId.Value, WireRole(alreadyRole));
        }

        // A public Collection needs no request (its contents are open to the link), and one still on the legacy common-lock password takes no new people.
        if (isPublic.Value || await IsLegacyCommonLockAsync(collectionId.Value, cancellationToken))
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.NotAllowed, collectionId.Value, ownerUserId.Value);
        }

        var pending = await dbContext.CollectionJoinRequests.AsNoTracking()
            .Where(request => request.CollectionId == collectionId.Value && request.RequesterUserId == userId && request.Status == CollectionJoinRequestStatus.Pending)
            .Select(request => (long?)request.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (pending is { } pendingId)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyRequested, collectionId.Value, ownerUserId.Value, RequestId: pendingId);
        }

        var created = new CollectionJoinRequest(collectionId.Value, userId, nowUtc);
        dbContext.CollectionJoinRequests.Add(created);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyRequested, collectionId.Value, ownerUserId.Value);
        }

        return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested, collectionId.Value, ownerUserId.Value, RequestId: created.Id);
    }

    public async Task<CollectionJoinStoreResult> SavePublicAsync(string publicId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var collectionId = await dbContext.CollectionShares.AsNoTracking()
            .Where(share => share.PublicId == publicId && share.IsActive)
            .Select(share => (long?)share.CollectionId)
            .FirstOrDefaultAsync(cancellationToken);
        if (collectionId is null)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Unavailable);
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId.Value, cancellationToken);
        if (ownerUserId is null)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Unavailable);
        }

        // The link as it is now, under the lock: still this link, still active - and still PUBLIC.
        var isPublic = await dbContext.CollectionShares.AsNoTracking()
            .Where(candidate => candidate.CollectionId == collectionId.Value && candidate.IsActive && candidate.PublicId == publicId)
            .Select(candidate => (bool?)candidate.IsPublic)
            .FirstOrDefaultAsync(cancellationToken);
        if (isPublic is null)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Unavailable);
        }

        if (ownerUserId == userId)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, collectionId.Value, ownerUserId.Value, "owner");
        }

        var existingRole = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => collaborator.CollectionId == collectionId.Value && collaborator.UserId == userId)
            .Select(collaborator => (CollectionCollaboratorRole?)collaborator.Role)
            .FirstOrDefaultAsync(cancellationToken);
        if (existingRole is { } alreadyRole)
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, collectionId.Value, ownerUserId.Value, WireRole(alreadyRole));
        }

        // A private link is requested, not saved; a Collection still on the legacy common-lock password takes no new people.
        if (!isPublic.Value || await IsLegacyCommonLockAsync(collectionId.Value, cancellationToken))
        {
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.NotAllowed, collectionId.Value, ownerUserId.Value);
        }

        dbContext.CollectionCollaborators.Add(new CollectionCollaborator(collectionId.Value, userId, ApprovedRole, ownerUserId.Value, nowUtc));
        await ObsoletePendingAsync(collectionId.Value, userId, nowUtc, cancellationToken);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // Saved twice at once (only possible outside the lock): the other call won - the caller is a member.
            dbContext.ChangeTracker.Clear();
            return new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, collectionId.Value, ownerUserId.Value, WireRole(ApprovedRole));
        }

        return new CollectionJoinStoreResult(CollectionJoinStoreStatus.Joined, collectionId.Value, ownerUserId.Value, WireRole(ApprovedRole));
    }

    public async Task<IReadOnlyList<MyCollectionJoinRequestDto>> ListMineAsync(long userId, CancellationToken cancellationToken = default)
    {
        // The caller's own waiting requests of Collections that still exist and whose link is still on: one joined query on the
        // indexed RequesterUserId. Name and look only (icon, color, the Collection's own photo) - never content, never anyone else's data.
        var rows = await (
                from request in dbContext.CollectionJoinRequests.AsNoTracking()
                where request.RequesterUserId == userId && request.Status == CollectionJoinRequestStatus.Pending
                join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                    on request.CollectionId equals collection.Id
                join share in dbContext.CollectionShares.AsNoTracking().Where(share => share.IsActive)
                    on request.CollectionId equals share.CollectionId
                orderby request.Id descending
                select new { request.Id, share.PublicId, collection.Name, Icon = collection.Icon, collection.Color, request.CreatedAtUtc, collection.UserId, collection.IconImageBlobName })
            .ToListAsync(cancellationToken);

        var result = new List<MyCollectionJoinRequestDto>(rows.Count);
        foreach (var row in rows)
        {
            string? url = null;
            string? version = null;
            if (iconImageStorage is not null && row.IconImageBlobName is not null)
            {
                var signed = await iconImageStorage.CreateCollectionIconReadUrlAsync(row.UserId, row.IconImageBlobName, cancellationToken);
                if (signed is not null)
                {
                    url = signed.ToString();
                    version = Juple.Application.Collections.SetCollectionIconImage.CollectionIconImageVersion.From(row.IconImageBlobName);
                }
            }

            result.Add(new MyCollectionJoinRequestDto(row.Id, row.PublicId, row.Name, row.Icon.ToString(), row.Color, row.CreatedAtUtc, url, version));
        }

        return result;
    }

    public async Task<CollectionJoinRequestPage> ListPendingAsync(long collectionId, long? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var query = dbContext.CollectionJoinRequests.AsNoTracking()
            .Where(request => request.CollectionId == collectionId && request.Status == CollectionJoinRequestStatus.Pending);
        if (cursor is { } after)
        {
            query = query.Where(request => request.Id > after);
        }

        // Requests and the requesters' public identity in two queries for the whole page - no per-row lookup.
        var rows = await (
                from request in query.OrderBy(request => request.Id).Take(limit + 1)
                join user in dbContext.Users.AsNoTracking() on request.RequesterUserId equals user.Id
                select new { request.Id, request.CreatedAtUtc, UserId = user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = hasMore ? rows.GetRange(0, limit) : rows;

        var items = new List<CollectionJoinRequestDto>(page.Count);
        foreach (var row in page)
        {
            var image = profileImageStorage is null
                ? new UserProfileImageRef(null, null)
                : await profileImageStorage.ResolveProfileImageAsync(row.UserId, row.ProfileImageBlobName, cancellationToken);
            items.Add(new CollectionJoinRequestDto(row.Id, row.PublicCode, row.DisplayName, image.Url, image.Version, row.CreatedAtUtc));
        }

        return new CollectionJoinRequestPage(items, hasMore ? page[^1].Id : null);
    }

    public async Task<ResolvedCollectionJoinRequest> ApproveAsync(
        long ownerUserId, long collectionId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) != ownerUserId)
        {
            throw new CollectionJoinRequestNotFoundException();
        }

        var request = await dbContext.CollectionJoinRequests
            .FirstOrDefaultAsync(entry => entry.Id == requestId && entry.CollectionId == collectionId, cancellationToken);
        if (request is null || request.Status != CollectionJoinRequestStatus.Pending)
        {
            throw new CollectionJoinRequestNotFoundException();
        }

        // The link as it is NOW: a request cannot be approved once the link was turned off or its contents became public (then nobody needs approval).
        var isPublic = await dbContext.CollectionShares.AsNoTracking()
            .Where(candidate => candidate.CollectionId == collectionId && candidate.IsActive)
            .Select(candidate => (bool?)candidate.IsPublic)
            .FirstOrDefaultAsync(cancellationToken);

        var existingRole = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => collaborator.CollectionId == collectionId && collaborator.UserId == request.RequesterUserId)
            .Select(collaborator => (CollectionCollaboratorRole?)collaborator.Role)
            .FirstOrDefaultAsync(cancellationToken);
        if (existingRole is { } already)
        {
            request.Resolve(CollectionJoinRequestStatus.Obsolete, ownerUserId, nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ResolvedCollectionJoinRequest(request.RequesterUserId, WireRole(already), WasObsolete: true);
        }

        if (isPublic is null || isPublic.Value || await IsLegacyCommonLockAsync(collectionId, cancellationToken))
        {
            throw new Juple.Application.Collections.CollectionCollaborationConflictException(
                Juple.Application.Collections.CollectionCollaborationConflictException.JoinNotAllowed);
        }

        var role = ApprovedRole;
        dbContext.CollectionCollaborators.Add(new CollectionCollaborator(collectionId, request.RequesterUserId, role, ownerUserId, nowUtc));
        request.Resolve(CollectionJoinRequestStatus.Approved, ownerUserId, nowUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // Became a member between our read and the write (only possible outside the lock): nothing left to decide.
            throw new CollectionJoinRequestNotFoundException();
        }

        return new ResolvedCollectionJoinRequest(request.RequesterUserId, WireRole(role), WasObsolete: false);
    }

    public async Task<ResolvedCollectionJoinRequest?> RejectAsync(
        long ownerUserId, long collectionId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) != ownerUserId)
        {
            throw new CollectionJoinRequestNotFoundException();
        }

        var request = await dbContext.CollectionJoinRequests
            .FirstOrDefaultAsync(entry => entry.Id == requestId && entry.CollectionId == collectionId, cancellationToken);
        if (request is null || request.Status != CollectionJoinRequestStatus.Pending)
        {
            return null;
        }

        request.Resolve(CollectionJoinRequestStatus.Rejected, ownerUserId, nowUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ResolvedCollectionJoinRequest(request.RequesterUserId, null, WasObsolete: false);
    }

    /// <summary>The same rule invitations follow: a Collection still on the legacy common-lock password takes no new people.</summary>
    private Task<bool> IsLegacyCommonLockAsync(long collectionId, CancellationToken cancellationToken) =>
        dbContext.CollectionSharePasswords.AsNoTracking()
            .AnyAsync(password => password.CollectionId == collectionId && password.Mode == CollectionSharePasswordMode.LegacyCommonLock, cancellationToken);

    private Task<int> ObsoletePendingAsync(long collectionId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken) =>
        dbContext.CollectionJoinRequests
            .Where(request => request.CollectionId == collectionId && request.RequesterUserId == userId && request.Status == CollectionJoinRequestStatus.Pending)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(request => request.Status, CollectionJoinRequestStatus.Obsolete)
                .SetProperty(request => request.ResolvedAtUtc, nowUtc), cancellationToken);

    private static string WireRole(CollectionCollaboratorRole role) => role.ToString().ToLowerInvariant();
}

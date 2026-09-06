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
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (!collectionOwned)
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

        var share = new CollectionShare(collectionId, candidatePublicId, enabledAtUtc);
        dbContext.CollectionShares.Add(share);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent EnableAsync call for this same Collection already won the race on
            // UX_CollectionShares_CollectionId_Active - re-read and return that winner instead of
            // ever persisting a second active share for this Collection.
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
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
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
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
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

    private static CollectionShareDto ToDto(CollectionShare share) =>
        new(share.CollectionId, share.PublicId, share.CreatedAtUtc);
}

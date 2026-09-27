namespace Juple.Domain.Collections;

/// <summary>
/// One user's personal "favorite" mark on a Collection they can access - the Owner's own Collection
/// or one shared with them as a Contributor. Strictly per user: nobody else's view of the
/// Collection changes. The only store of a Contributor's mark; an Owner's mark is kept here and in the
/// legacy Collection.IsFavorite column in step (see Collection.IsFavorite).
/// </summary>
public sealed class CollectionFavorite
{
    private CollectionFavorite()
    {
    }

    public CollectionFavorite(long userId, long collectionId, DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        CollectionId = collectionId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public long CollectionId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}

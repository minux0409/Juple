namespace Juple.Application.Collections.SetCollectionFavorite;

public interface ISetCollectionFavoriteService
{
    Task<CollectionDto> SetFavoriteAsync(
        long userId,
        long collectionId,
        SetCollectionFavoriteCommand command,
        CancellationToken cancellationToken = default);
}

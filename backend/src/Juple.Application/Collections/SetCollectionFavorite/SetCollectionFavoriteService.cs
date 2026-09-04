namespace Juple.Application.Collections.SetCollectionFavorite;

public sealed class SetCollectionFavoriteService(
    ICollectionStore collectionStore,
    TimeProvider timeProvider) : ISetCollectionFavoriteService
{
    public Task<CollectionDto> SetFavoriteAsync(
        long userId,
        long collectionId,
        SetCollectionFavoriteCommand command,
        CancellationToken cancellationToken = default) =>
        collectionStore.SetFavoriteAsync(
            userId, collectionId, command.IsFavorite, timeProvider.GetUtcNow(), cancellationToken);
}

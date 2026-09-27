using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.SetCollectionFavorite;

/// <summary>
/// A personal mark: Owner and Contributor alike may favorite a Collection they can access (it
/// changes nothing for anyone else); no access is the same 404 as a missing Collection. Not gated
/// by the lock - like the Collection card, it reveals nothing of the content.
/// </summary>
public sealed class SetCollectionFavoriteService(
    ICollectionAccessService accessService,
    ICollectionStore collectionStore,
    TimeProvider timeProvider) : ISetCollectionFavoriteService
{
    public async Task<CollectionDto> SetFavoriteAsync(
        long userId,
        long collectionId,
        SetCollectionFavoriteCommand command,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.Favorite, cancellationToken);
        return await collectionStore.SetFavoriteAsync(
            userId, collectionId, command.IsFavorite, timeProvider.GetUtcNow(), cancellationToken);
    }
}
